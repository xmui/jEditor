// jEditor for Mac: the Photos library (PhotoKit). main.js asks
// for these and the page gets them through the app:// protocol and the
// bridge (bridge.js: photosAlbum). Everything but authStatus returns a
// promise; the work runs off the main thread, with PhotoKit's synchronous
// calls, so a slow iCloud download never holds up the window.
//
//   authStatus()         → 'granted' | 'limited' | 'denied' | 'restricted' | 'ask'
//   requestAuth()        → the same, once macOS has asked (only the built app
//                          may ask: it needs NSPhotoLibraryUsageDescription)
//   collections()        → [{ id, kind: favourites | recent | album, name, count }]
//   assets(id)           → [{ id, originalFilename, created, fileSize, w, h }],
//                          photos only, oldest first; id '' is the whole library
//   thumbnail(id, px)    → a JPEG Buffer, fitting px × px
//   image(id)            → { data: Buffer, type: 'image/jpeg' | 'image/png' | … }:
//                          the photo as it is now (edits included), as JPEG
//                          unless it's already JPEG, PNG, GIF or WebP, with
//                          its EXIF kept; from iCloud if it isn't on this Mac
//   save(id, bytes)      → { modified, fileSize, w, h }: bytes (the photo as
//                          jEditor made it from image(): the current version)
//                          saved as a Photos edit, so it's the new current
//                          version, in Photos and on every device. Photos
//                          keeps the original and the edits before (Revert
//                          to Original). macOS may ask to allow the change.
//   add(paths, album)    → { added, album: { id, name } }: files put into the
//                          library as new photos, as they are, in the album
//                          of that name (made if there's none)

#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <Photos/Photos.h>
#import <ImageIO/ImageIO.h>
#include <napi.h>
#include <string>

// ---- To JavaScript ----

static Napi::Value ToJS(Napi::Env env, id v) {
    if (!v || v == [NSNull null]) return env.Null();
    if ([v isKindOfClass:[NSString class]]) return Napi::String::New(env, [(NSString *)v UTF8String]);
    if ([v isKindOfClass:[NSNumber class]]) {
        if (CFGetTypeID((__bridge CFTypeRef)v) == CFBooleanGetTypeID()) return Napi::Boolean::New(env, [v boolValue]);
        return Napi::Number::New(env, [v doubleValue]);
    }
    if ([v isKindOfClass:[NSData class]]) {
        NSData *d = v;
        return Napi::Buffer<uint8_t>::Copy(env, (const uint8_t *)d.bytes, d.length);
    }
    if ([v isKindOfClass:[NSArray class]]) {
        NSArray *a = v;
        Napi::Array out = Napi::Array::New(env, a.count);
        for (NSUInteger i = 0; i < a.count; i++) out.Set((uint32_t)i, ToJS(env, a[i]));
        return out;
    }
    if ([v isKindOfClass:[NSDictionary class]]) {
        NSDictionary *d = v;
        Napi::Object out = Napi::Object::New(env);
        for (NSString *k in d) out.Set([k UTF8String], ToJS(env, d[k]));
        return out;
    }
    return env.Undefined();
}

// ---- A job off the main thread, as a promise ----
// The block returns what to resolve with, or an NSError to reject with

typedef id (^Work)(void);

class Job : public Napi::AsyncWorker {
public:
    Job(Napi::Env env, Work work) : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), work_(work) {}
    Napi::Promise Promise() { return deferred_.Promise(); }

    void Execute() override {
        @autoreleasepool {
            id r = work_();
            if ([r isKindOfClass:[NSError class]]) {
                SetError(std::string([[(NSError *)r localizedDescription] UTF8String]));
            } else {
                result_ = r;
            }
            work_ = nil;
        }
    }
    void OnOK() override {
        Napi::HandleScope scope(Env());
        deferred_.Resolve(ToJS(Env(), result_));
        result_ = nil;
    }
    void OnError(const Napi::Error &e) override {
        Napi::HandleScope scope(Env());
        deferred_.Reject(e.Value());
    }

private:
    Napi::Promise::Deferred deferred_;
    Work work_;
    id result_ = nil;
};

static Napi::Value Run(Napi::Env env, Work work) {
    Job *job = new Job(env, work);
    Napi::Promise p = job->Promise();
    job->Queue();
    return p;
}

static NSError *Fail(NSString *text) {
    return [NSError errorWithDomain:@"jeditor.photos" code:1 userInfo:@{ NSLocalizedDescriptionKey: text }];
}

static NSString *Arg(const Napi::CallbackInfo &info, size_t i) {
    if (info.Length() <= i || !info[i].IsString()) return @"";
    return [NSString stringWithUTF8String:info[i].As<Napi::String>().Utf8Value().c_str()] ?: @"";
}

// ---- Access ----

static NSString *StatusName(PHAuthorizationStatus s) {
    switch (s) {
        case PHAuthorizationStatusAuthorized: return @"granted";
        case PHAuthorizationStatusLimited: return @"limited";
        case PHAuthorizationStatusDenied: return @"denied";
        case PHAuthorizationStatusRestricted: return @"restricted";
        default: return @"ask";
    }
}

static Napi::Value AuthStatus(const Napi::CallbackInfo &info) {
    PHAuthorizationStatus s = [PHPhotoLibrary authorizationStatusForAccessLevel:PHAccessLevelReadWrite];
    return Napi::String::New(info.Env(), [StatusName(s) UTF8String]);
}

static Napi::Value RequestAuth(const Napi::CallbackInfo &info) {
    return Run(info.Env(), ^id {
        __block PHAuthorizationStatus got = PHAuthorizationStatusNotDetermined;
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelReadWrite handler:^(PHAuthorizationStatus s) {
            got = s;
            dispatch_semaphore_signal(done);
        }];
        dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
        return StatusName(got);
    });
}

static BOOL Allowed() {
    PHAuthorizationStatus s = [PHPhotoLibrary authorizationStatusForAccessLevel:PHAccessLevelReadWrite];
    return s == PHAuthorizationStatusAuthorized || s == PHAuthorizationStatusLimited;
}

// ---- What's in it ----

static PHFetchOptions *PhotosOnly(BOOL sorted) {
    PHFetchOptions *o = [[PHFetchOptions alloc] init];
    o.predicate = [NSPredicate predicateWithFormat:@"mediaType == %d", (int)PHAssetMediaTypeImage];
    if (sorted) o.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"creationDate" ascending:YES]];
    return o;
}

static NSUInteger CountIn(PHAssetCollection *c) {
    return [PHAsset fetchAssetsInAssetCollection:c options:PhotosOnly(NO)].count;
}

static Napi::Value Collections(const Napi::CallbackInfo &info) {
    return Run(info.Env(), ^id {
        if (!Allowed()) return Fail(@"jEditor isn't allowed to see the Photos library");
        NSMutableArray *out = [NSMutableArray array];
        void (^smart)(PHAssetCollectionSubtype, NSString *) = ^(PHAssetCollectionSubtype sub, NSString *kind) {
            PHAssetCollection *c = [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum subtype:sub options:nil].firstObject;
            if (c) [out addObject:@{ @"id": c.localIdentifier, @"kind": kind, @"name": c.localizedTitle ?: kind, @"count": @(CountIn(c)) }];
        };
        smart(PHAssetCollectionSubtypeSmartAlbumFavorites, @"favourites");
        smart(PHAssetCollectionSubtypeSmartAlbumRecentlyAdded, @"recent");
        // The user's own albums, those in folders too, by name
        NSMutableArray *albums = [NSMutableArray array];
        PHFetchResult<PHAssetCollection *> *all = [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeAlbum subtype:PHAssetCollectionSubtypeAlbumRegular options:nil];
        for (PHAssetCollection *c in all) {
            [albums addObject:@{ @"id": c.localIdentifier, @"kind": @"album", @"name": c.localizedTitle ?: @"Album", @"count": @(CountIn(c)) }];
        }
        [albums sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            return [a[@"name"] localizedStandardCompare:b[@"name"]];
        }];
        [out addObjectsFromArray:albums];
        return out;
    });
}

static PHAssetResource *MainResource(PHAsset *a) {
    NSArray<PHAssetResource *> *rs = [PHAssetResource assetResourcesForAsset:a];
    for (PHAssetResource *r in rs) if (r.type == PHAssetResourceTypePhoto) return r;
    return rs.firstObject;
}

static Napi::Value Assets(const Napi::CallbackInfo &info) {
    NSString *cid = Arg(info, 0);
    return Run(info.Env(), ^id {
        if (!Allowed()) return Fail(@"jEditor isn't allowed to see the Photos library");
        PHFetchResult<PHAsset *> *found;
        if (!cid.length) {
            found = [PHAsset fetchAssetsWithOptions:PhotosOnly(YES)];
        } else {
            PHAssetCollection *c = [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[cid] options:nil].firstObject;
            if (!c) return Fail(@"That album isn't there any more");
            found = [PHAsset fetchAssetsInAssetCollection:c options:PhotosOnly(YES)];
        }
        NSMutableArray *out = [NSMutableArray arrayWithCapacity:found.count];
        for (PHAsset *a in found) {
            @autoreleasepool {
                PHAssetResource *r = MainResource(a);
                // The size of the photo as it is now: an edited one's is its
                // full-size rendering, so it changes when it's edited (jEditor's
                // kept edits for it are then out of date, as for a changed file)
                PHAssetResource *now = r;
                for (PHAssetResource *x in [PHAssetResource assetResourcesForAsset:a]) if (x.type == PHAssetResourceTypeFullSizePhoto) now = x;
                id size = nil;
                // Not in the headers, but how every photo app gets it
                @try { size = [now valueForKey:@"fileSize"]; } @catch (NSException *e) { size = nil; }
                [out addObject:@{
                    @"id": a.localIdentifier,
                    @"originalFilename": r.originalFilename ?: @"Photo.jpg",
                    @"created": @(a.creationDate ? a.creationDate.timeIntervalSince1970 * 1000 : 0),
                    @"fileSize": [size isKindOfClass:[NSNumber class]] ? size : @0,
                    @"modified": @(a.modificationDate ? a.modificationDate.timeIntervalSince1970 * 1000 : 0),
                    @"w": @(a.pixelWidth),
                    @"h": @(a.pixelHeight)
                }];
            }
        }
        return out;
    });
}

static PHAsset *AssetFor(NSString *aid) {
    if (!aid.length) return nil;
    return [PHAsset fetchAssetsWithLocalIdentifiers:@[aid] options:nil].firstObject;
}

// ---- Pictures of it ----

static NSData *Encode(CGImageRef img, CFStringRef type, double quality) {
    NSMutableData *out = [NSMutableData data];
    CGImageDestinationRef dest = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)out, type, 1, NULL);
    if (!dest) return nil;
    NSDictionary *opts = @{ (__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @(quality) };
    CGImageDestinationAddImage(dest, img, (__bridge CFDictionaryRef)opts);
    BOOL ok = CGImageDestinationFinalize(dest);
    CFRelease(dest);
    return ok ? out : nil;
}

static Napi::Value Thumbnail(const Napi::CallbackInfo &info) {
    NSString *aid = Arg(info, 0);
    double px = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 320;
    if (px < 16) px = 16;
    if (px > 2048) px = 2048;
    return Run(info.Env(), ^id {
        PHAsset *a = AssetFor(aid);
        if (!a) return Fail(@"That photo isn't in the library any more");
        PHImageRequestOptions *o = [[PHImageRequestOptions alloc] init];
        o.synchronous = YES;
        o.deliveryMode = PHImageRequestOptionsDeliveryModeHighQualityFormat;
        o.resizeMode = PHImageRequestOptionsResizeModeFast;
        o.networkAccessAllowed = YES;
        __block NSImage *got = nil;
        [[PHImageManager defaultManager] requestImageForAsset:a targetSize:CGSizeMake(px, px) contentMode:PHImageContentModeAspectFit options:o resultHandler:^(NSImage *result, NSDictionary *meta) {
            got = result;
        }];
        if (!got) return Fail(@"No thumbnail for that photo");
        CGImageRef cg = [got CGImageForProposedRect:NULL context:nil hints:nil];
        NSData *jpeg = cg ? Encode(cg, CFSTR("public.jpeg"), 0.8) : nil;
        return jpeg ?: Fail(@"The thumbnail couldn't be made");
    });
}

// Shown as they are; anything else (HEIC, RAW, TIFF) becomes a JPEG
static NSString *Passes(NSString *uti) {
    NSDictionary *as = @{ @"public.jpeg": @"image/jpeg", @"public.png": @"image/png", @"com.compuserve.gif": @"image/gif", @"org.webmproject.webp": @"image/webp" };
    return uti ? as[uti] : nil;
}

static Napi::Value FullImage(const Napi::CallbackInfo &info) {
    NSString *aid = Arg(info, 0);
    return Run(info.Env(), ^id {
        PHAsset *a = AssetFor(aid);
        if (!a) return Fail(@"That photo isn't in the library any more");
        PHImageRequestOptions *o = [[PHImageRequestOptions alloc] init];
        o.synchronous = YES;
        o.version = PHImageRequestOptionsVersionCurrent;
        o.deliveryMode = PHImageRequestOptionsDeliveryModeHighQualityFormat;
        o.networkAccessAllowed = YES;
        __block NSData *data = nil;
        __block NSString *uti = nil;
        [[PHImageManager defaultManager] requestImageDataAndOrientationForAsset:a options:o resultHandler:^(NSData *d, NSString *type, CGImagePropertyOrientation orientation, NSDictionary *meta) {
            data = d;
            uti = type;
        }];
        if (!data.length) return Fail(@"That photo couldn't be read (is it still downloading from iCloud?)");
        NSString *mime = Passes(uti);
        if (mime) return @{ @"data": data, @"type": mime };
        // To JPEG with its metadata (EXIF, GPS, orientation, colour profile) kept
        CGImageSourceRef src = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
        if (!src) return Fail(@"That photo couldn't be read");
        NSMutableData *out = [NSMutableData data];
        CGImageDestinationRef dest = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)out, CFSTR("public.jpeg"), 1, NULL);
        BOOL ok = NO;
        if (dest) {
            NSDictionary *opts = @{ (__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @0.92 };
            CGImageDestinationAddImageFromSource(dest, src, 0, (__bridge CFDictionaryRef)opts);
            ok = CGImageDestinationFinalize(dest);
            CFRelease(dest);
        }
        CFRelease(src);
        if (!ok) return Fail(@"That photo couldn't be made into a JPEG");
        return @{ @"data": out, @"type": @"image/jpeg" };
    });
}

// ---- Saving edits back (a Photos edit on the current version) ----

// What jEditor's edits are called in Photos' adjustment data. jEditor
// never claims it can read anyone's adjustment data (its own included), so
// PhotoKit always gives it the photo as it is now, every earlier edit
// applied: jEditor's edit stacks on top, and Photos keeps what was there.
static NSString *const kFormat = @"app.jeditor.edit";

// The bytes as an upright JPEG with their metadata (Photos' rendered
// version must be a JPEG, and has no orientation of its own to lean on)
static NSData *RenderedJPEG(NSData *bytes, NSError **err) {
    CGImageSourceRef src = CGImageSourceCreateWithData((__bridge CFDataRef)bytes, NULL);
    if (!src) { *err = Fail(@"jEditor's edit couldn't be read"); return nil; }
    NSDictionary *props = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(src, 0, NULL)) ?: @{};
    NSString *uti = (__bridge NSString *)CGImageSourceGetType(src);
    int orientation = [props[(__bridge NSString *)kCGImagePropertyOrientation] intValue];
    if ([uti isEqualToString:@"public.jpeg"] && orientation <= 1) {
        CFRelease(src);
        return bytes;
    }
    NSMutableDictionary *meta = [props mutableCopy];
    meta[(__bridge NSString *)kCGImagePropertyOrientation] = @1;
    NSMutableDictionary *tiff = [meta[(__bridge NSString *)kCGImagePropertyTIFFDictionary] mutableCopy];
    if (tiff) { tiff[(__bridge NSString *)kCGImagePropertyTIFFOrientation] = @1; meta[(__bridge NSString *)kCGImagePropertyTIFFDictionary] = tiff; }
    meta[(__bridge NSString *)kCGImageDestinationLossyCompressionQuality] = @0.92;
    CGImageRef img = NULL;
    if (orientation > 1) {
        // Turned upright at full size
        double w = [props[(__bridge NSString *)kCGImagePropertyPixelWidth] doubleValue];
        double h = [props[(__bridge NSString *)kCGImagePropertyPixelHeight] doubleValue];
        NSDictionary *o = @{
            (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
            (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
            (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @(MAX(w, h))
        };
        img = CGImageSourceCreateThumbnailAtIndex(src, 0, (__bridge CFDictionaryRef)o);
    } else {
        img = CGImageSourceCreateImageAtIndex(src, 0, NULL);
    }
    CFRelease(src);
    if (!img) { *err = Fail(@"jEditor's edit couldn't be read"); return nil; }
    NSMutableData *out = [NSMutableData data];
    CGImageDestinationRef dest = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)out, CFSTR("public.jpeg"), 1, NULL);
    BOOL ok = NO;
    if (dest) {
        CGImageDestinationAddImage(dest, img, (__bridge CFDictionaryRef)meta);
        ok = CGImageDestinationFinalize(dest);
        CFRelease(dest);
    }
    CGImageRelease(img);
    if (!ok) { *err = Fail(@"jEditor's edit couldn't be made into a JPEG"); return nil; }
    return out;
}

static Napi::Value Save(const Napi::CallbackInfo &info) {
    NSString *aid = Arg(info, 0);
    if (info.Length() < 2 || !info[1].IsTypedArray()) {
        Napi::TypeError::New(info.Env(), "save(id, bytes): bytes is a Uint8Array").ThrowAsJavaScriptException();
        return info.Env().Undefined();
    }
    Napi::Uint8Array arr = info[1].As<Napi::Uint8Array>();
    NSData *bytes = [NSData dataWithBytes:arr.Data() length:arr.ByteLength()];
    return Run(info.Env(), ^id {
        if (!Allowed()) return Fail(@"jEditor isn't allowed to change the Photos library");
        PHAsset *a = AssetFor(aid);
        if (!a) return Fail(@"That photo isn't in the library any more");
        if (![a canPerformEditOperation:PHAssetEditOperationContent]) return Fail(@"Photos doesn't allow that photo to be edited");
        NSError *err = nil;
        NSData *jpeg = RenderedJPEG(bytes, &err);
        if (!jpeg) return err;

        // The photo as it is now (canHandleAdjustmentData: NO), from iCloud if need be.
        // Photos answers on the main thread, which is free: this runs off it.
        PHContentEditingInputRequestOptions *ro = [[PHContentEditingInputRequestOptions alloc] init];
        ro.networkAccessAllowed = YES;
        ro.canHandleAdjustmentData = ^BOOL(PHAdjustmentData *d) { return NO; };
        __block PHContentEditingInput *input = nil;
        dispatch_semaphore_t got = dispatch_semaphore_create(0);
        [a requestContentEditingInputWithOptions:ro completionHandler:^(PHContentEditingInput *editing, NSDictionary *meta) {
            input = editing;
            dispatch_semaphore_signal(got);
        }];
        if (dispatch_semaphore_wait(got, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC))) return Fail(@"Photos didn't answer (is the photo still downloading from iCloud?)");
        if (!input) return Fail(@"Photos couldn't open that photo for editing");

        PHContentEditingOutput *out = [[PHContentEditingOutput alloc] initWithContentEditingInput:input];
        NSDictionary *note = @{ @"app": @"jEditor", @"on": @"current", @"at": @((long long)([[NSDate date] timeIntervalSince1970] * 1000)) };
        NSData *payload = [NSJSONSerialization dataWithJSONObject:note options:0 error:nil];
        out.adjustmentData = [[PHAdjustmentData alloc] initWithFormatIdentifier:kFormat formatVersion:@"1" data:payload];
        if (![jpeg writeToURL:out.renderedContentURL options:NSDataWritingAtomic error:&err]) return err ?: Fail(@"The edit couldn't be written");
        BOOL ok = [[PHPhotoLibrary sharedPhotoLibrary] performChangesAndWait:^{
            PHAssetChangeRequest *r = [PHAssetChangeRequest changeRequestForAsset:a];
            r.contentEditingOutput = out;
        } error:&err];
        if (!ok) return err ?: Fail(@"Photos didn't take the edit");
        PHAsset *now = AssetFor(aid) ?: a;
        return @{
            @"modified": @(now.modificationDate ? now.modificationDate.timeIntervalSince1970 * 1000 : [[NSDate date] timeIntervalSince1970] * 1000),
            @"fileSize": @(jpeg.length),
            @"w": @(now.pixelWidth),
            @"h": @(now.pixelHeight)
        };
    });
}

// ---- Adding photos (a scan order, a card, an export) ----

static Napi::Value Add(const Napi::CallbackInfo &info) {
    NSMutableArray<NSString *> *paths = [NSMutableArray array];
    if (info.Length() > 0 && info[0].IsArray()) {
        Napi::Array a = info[0].As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); i++) {
            Napi::Value v = a.Get(i);
            if (v.IsString()) [paths addObject:[NSString stringWithUTF8String:v.As<Napi::String>().Utf8Value().c_str()] ?: @""];
        }
    }
    NSString *title = Arg(info, 1);
    return Run(info.Env(), ^id {
        if (!Allowed()) return Fail(@"jEditor isn't allowed to change the Photos library");
        // The album of that name, or a new one
        __block PHAssetCollection *album = nil;
        if (title.length) {
            PHFetchResult<PHAssetCollection *> *all = [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeAlbum subtype:PHAssetCollectionSubtypeAlbumRegular options:nil];
            for (PHAssetCollection *c in all) if ([c.localizedTitle isEqualToString:title]) { album = c; break; }
        }
        NSError *err = nil;
        if (title.length && !album) {
            __block NSString *made = nil;
            BOOL ok = [[PHPhotoLibrary sharedPhotoLibrary] performChangesAndWait:^{
                made = [PHAssetCollectionChangeRequest creationRequestForAssetCollectionWithTitle:title].placeholderForCreatedAssetCollection.localIdentifier;
            } error:&err];
            if (!ok || !made) return err ?: Fail(@"The album couldn't be made");
            album = [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[made] options:nil].firstObject;
        }
        // In tens, so a big order shows in Photos as it goes and one bad file spoils only its ten
        NSUInteger added = 0;
        for (NSUInteger i = 0; i < paths.count; i += 10) {
            NSArray *some = [paths subarrayWithRange:NSMakeRange(i, MIN((NSUInteger)10, paths.count - i))];
            BOOL ok = [[PHPhotoLibrary sharedPhotoLibrary] performChangesAndWait:^{
                NSMutableArray *made = [NSMutableArray array];
                for (NSString *p in some) {
                    PHAssetCreationRequest *r = [PHAssetCreationRequest creationRequestForAsset];
                    PHAssetResourceCreationOptions *o = [[PHAssetResourceCreationOptions alloc] init];
                    o.originalFilename = p.lastPathComponent;
                    o.shouldMoveFile = NO;
                    [r addResourceWithType:PHAssetResourceTypePhoto fileURL:[NSURL fileURLWithPath:p] options:o];
                    if (r.placeholderForCreatedAsset) [made addObject:r.placeholderForCreatedAsset];
                }
                if (album && made.count) [[PHAssetCollectionChangeRequest changeRequestForAssetCollection:album] addAssets:made];
            } error:&err];
            if (!ok) return err ?: Fail(@"Photos didn't take those photos");
            added += some.count;
        }
        return @{ @"added": @(added), @"album": album ? (id)@{ @"id": album.localIdentifier, @"name": album.localizedTitle ?: title } : (id)[NSNull null] };
    });
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("authStatus", Napi::Function::New(env, AuthStatus));
    exports.Set("requestAuth", Napi::Function::New(env, RequestAuth));
    exports.Set("collections", Napi::Function::New(env, Collections));
    exports.Set("assets", Napi::Function::New(env, Assets));
    exports.Set("thumbnail", Napi::Function::New(env, Thumbnail));
    exports.Set("image", Napi::Function::New(env, FullImage));
    exports.Set("save", Napi::Function::New(env, Save));
    exports.Set("add", Napi::Function::New(env, Add));
    return exports;
}

NODE_API_MODULE(photos, Init)
