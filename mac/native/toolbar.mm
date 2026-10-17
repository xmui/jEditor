// jEditor for Mac: the window's toolbar, native. On macOS 26 a window's
// NSToolbar is drawn in Liquid Glass over what's under it (the photos), as
// in Apple's own apps; the page (bridge.js) says what's in it and hears
// what's clicked. Every item stands for one of the page's own controls.
//
//   supported()                 → true from macOS 26 (glass), else false
//   attach(handle, onAction)    → a toolbar for the window (handle: its
//                                 getNativeWindowHandle()); onAction(id, value)
//   update(handle, model)       → { title, subtitle, visible, items: [...] }
//   focusSearch(handle)         → the search field takes the keys
//   describe(handle)            → what the toolbar shows (for the tests)
//   click(handle, id, value)    → as if clicked (for the tests)
//   hitAt(handle, x, y)         → the views under that point of the window
//                                 (from its top left, in points), innermost
//                                 first, by class (for the tests)
//   detach(handle)
//
// An item: { id, kind: button | menu | segment | search | flexible,
//   symbol (an SF Symbol), label, tooltip, enabled, navigational,
//   menu: [{ id, label, symbol, enabled, checked, separator }] (menu),
//   segments: [label], selected (segment), value, placeholder (search) }

#import <AppKit/AppKit.h>
#include <napi.h>
#include <string>

static NSString *Str(const Napi::Value &v) {
    return v.IsString() ? [NSString stringWithUTF8String:v.As<Napi::String>().Utf8Value().c_str()] : @"";
}

static id ToObjC(const Napi::Value &v) {
    if (v.IsString()) return Str(v);
    if (v.IsBoolean()) return @(v.As<Napi::Boolean>().Value());
    if (v.IsNumber()) return @(v.As<Napi::Number>().DoubleValue());
    if (v.IsArray()) {
        Napi::Array a = v.As<Napi::Array>();
        NSMutableArray *out = [NSMutableArray arrayWithCapacity:a.Length()];
        for (uint32_t i = 0; i < a.Length(); i++) [out addObject:ToObjC(a.Get(i)) ?: [NSNull null]];
        return out;
    }
    if (v.IsObject()) {
        Napi::Object o = v.As<Napi::Object>();
        Napi::Array keys = o.GetPropertyNames();
        NSMutableDictionary *out = [NSMutableDictionary dictionary];
        for (uint32_t i = 0; i < keys.Length(); i++) {
            id val = ToObjC(o.Get(keys.Get(i)));
            if (val) out[Str(keys.Get(i))] = val;
        }
        return out;
    }
    return nil;
}

static NSString *S(NSDictionary *d, NSString *k) { id v = d[k]; return [v isKindOfClass:[NSString class]] ? v : @""; }
static BOOL B(NSDictionary *d, NSString *k, BOOL dflt) { id v = d[k]; return [v isKindOfClass:[NSNumber class]] ? [v boolValue] : dflt; }

static NSImage *Symbol(NSString *name, NSString *label) {
    if (!name.length) return nil;
    return [NSImage imageWithSystemSymbolName:name accessibilityDescription:label];
}

// The toolbar's empty space moves the window, as in any Mac app. The page
// lies under the toolbar (Electron's hidden title bar) and would get the
// press instead, so this view sits behind the toolbar's items, in the
// title bar, and takes it: a drag moves the window, a double-click does
// what System Settings → Desktop & Dock says (zoom, minimise or nothing).
@interface JEDragView : NSView
@end

@implementation JEDragView
- (BOOL)mouseDownCanMoveWindow { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)mouseDown:(NSEvent *)event {
    if (event.clickCount == 2) {
        NSString *action = [NSUserDefaults.standardUserDefaults stringForKey:@"AppleActionOnDoubleClick"];
        if ([action isEqualToString:@"Minimize"]) [self.window performMiniaturize:nil];
        else if (![action isEqualToString:@"None"]) [self.window performZoom:nil];
        return;
    }
    [self.window performWindowDragWithEvent:event];
}
@end

// Once per title bar (AppKit makes a new one in and out of full screen)
static void EnsureDragView(NSWindow *w) {
    NSView *bar = [w standardWindowButton:NSWindowCloseButton].superview;
    for (NSView *v = bar; v; v = v.superview) {
        if ([NSStringFromClass([v class]) isEqualToString:@"NSTitlebarView"]) { bar = v; break; }
    }
    if (!bar) return;
    for (NSView *v in bar.subviews) if ([v isKindOfClass:[JEDragView class]]) return;
    JEDragView *drag = [[JEDragView alloc] initWithFrame:bar.bounds];
    drag.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [bar addSubview:drag positioned:NSWindowBelow relativeTo:nil];
}

@interface JEToolbar : NSObject <NSToolbarDelegate, NSSearchFieldDelegate>
@property (nonatomic, weak) NSWindow *window;
@property (nonatomic, strong) NSToolbar *toolbar;
@property (nonatomic, copy) NSArray<NSString *> *ids;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *model;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSToolbarItem *> *made;
@property (nonatomic, assign) Napi::ThreadSafeFunction onAction;
@property (nonatomic, assign) NSInteger generation;
@property (nonatomic, strong) NSArray *observers;
@end

static NSMapTable<NSWindow *, JEToolbar *> *controllers;

static void Send(JEToolbar *t, NSString *ident, id value) {
    std::string i = ident.UTF8String;
    std::string kind = [value isKindOfClass:[NSNumber class]] ? "n" : "s";
    std::string s = [value isKindOfClass:[NSString class]] ? [(NSString *)value UTF8String] : "";
    double n = [value isKindOfClass:[NSNumber class]] ? [value doubleValue] : 0;
    t.onAction.NonBlockingCall([i, kind, s, n](Napi::Env env, Napi::Function fn) {
        fn.Call({ Napi::String::New(env, i), kind == "n" ? Napi::Value(Napi::Number::New(env, n)) : Napi::Value(Napi::String::New(env, s)) });
    });
}

@implementation JEToolbar

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar { return self.ids; }
- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar { return self.ids; }

- (NSToolbarItem *)toolbar:(NSToolbar *)toolbar itemForItemIdentifier:(NSToolbarItemIdentifier)ident willBeInsertedIntoToolbar:(BOOL)flag {
    NSDictionary *m = self.model[ident];
    if (!m) return nil;
    NSString *kind = S(m, @"kind");
    NSToolbarItem *item = nil;
    if ([kind isEqualToString:@"menu"]) {
        NSMenuToolbarItem *mi = [[NSMenuToolbarItem alloc] initWithItemIdentifier:ident];
        mi.showsIndicator = YES;
        item = mi;
    } else if ([kind isEqualToString:@"segment"]) {
        NSArray *titles = [m[@"segments"] isKindOfClass:[NSArray class]] ? m[@"segments"] : @[];
        NSToolbarItemGroup *g = [NSToolbarItemGroup groupWithItemIdentifier:ident titles:titles
            selectionMode:NSToolbarItemGroupSelectionModeSelectOne labels:titles target:self action:@selector(segmentChosen:)];
        item = g;
    } else if ([kind isEqualToString:@"search"]) {
        NSSearchToolbarItem *si = [[NSSearchToolbarItem alloc] initWithItemIdentifier:ident];
        si.searchField.delegate = self;
        si.searchField.sendsSearchStringImmediately = YES;
        item = si;
    } else {
        item = [[NSToolbarItem alloc] initWithItemIdentifier:ident];
        item.target = self;
        item.action = @selector(clicked:);
        item.bordered = YES;
    }
    item.autovalidates = NO;
    self.made[ident] = item;
    [self apply:m to:item];
    return item;
}

// The model's properties onto an item, made now or before
- (void)apply:(NSDictionary *)m to:(NSToolbarItem *)item {
    NSString *kind = S(m, @"kind");
    NSString *label = S(m, @"label");
    item.label = label;
    item.paletteLabel = label;
    item.toolTip = S(m, @"tooltip").length ? S(m, @"tooltip") : label;
    item.enabled = B(m, @"enabled", YES);
    item.navigational = B(m, @"navigational", NO);
    if (![kind isEqualToString:@"segment"] && ![kind isEqualToString:@"search"]) item.image = Symbol(S(m, @"symbol"), label);
    if ([kind isEqualToString:@"menu"]) {
        NSMenu *menu = [[NSMenu alloc] initWithTitle:label];
        menu.autoenablesItems = NO;
        for (NSDictionary *e in ([m[@"menu"] isKindOfClass:[NSArray class]] ? m[@"menu"] : @[])) {
            if (![e isKindOfClass:[NSDictionary class]]) continue;
            if (B(e, @"separator", NO)) { [menu addItem:[NSMenuItem separatorItem]]; continue; }
            NSMenuItem *mi = [[NSMenuItem alloc] initWithTitle:S(e, @"label") action:@selector(menuChosen:) keyEquivalent:@""];
            mi.target = self;
            mi.representedObject = @[item.itemIdentifier, S(e, @"id")];
            mi.enabled = B(e, @"enabled", YES);
            mi.state = B(e, @"checked", NO) ? NSControlStateValueOn : NSControlStateValueOff;
            mi.image = Symbol(S(e, @"symbol"), S(e, @"label"));
            [menu addItem:mi];
        }
        ((NSMenuToolbarItem *)item).menu = menu;
    } else if ([kind isEqualToString:@"segment"]) {
        NSToolbarItemGroup *g = (NSToolbarItemGroup *)item;
        NSInteger sel = [m[@"selected"] isKindOfClass:[NSNumber class]] ? [m[@"selected"] integerValue] : -1;
        if (g.selectedIndex != sel) g.selectedIndex = sel;
        for (NSToolbarItem *sub in g.subitems) sub.enabled = item.enabled;
    } else if ([kind isEqualToString:@"search"]) {
        NSSearchField *f = ((NSSearchToolbarItem *)item).searchField;
        f.placeholderString = S(m, @"placeholder");
        // Not while it's being typed in: that's where the value comes from
        if (f.window.firstResponder != f.currentEditor && ![f.stringValue isEqualToString:S(m, @"value")]) f.stringValue = S(m, @"value");
    }
}

- (void)clicked:(NSToolbarItem *)sender { Send(self, sender.itemIdentifier, @""); }
- (void)menuChosen:(NSMenuItem *)sender { NSArray *r = sender.representedObject; Send(self, r[0], r[1]); }
- (void)segmentChosen:(NSToolbarItemGroup *)sender { Send(self, sender.itemIdentifier, @(sender.selectedIndex)); }
- (void)controlTextDidChange:(NSNotification *)note {
    NSSearchField *f = note.object;
    for (NSString *ident in self.made) {
        NSToolbarItem *it = self.made[ident];
        if ([it isKindOfClass:[NSSearchToolbarItem class]] && ((NSSearchToolbarItem *)it).searchField == f) Send(self, ident, f.stringValue);
    }
}

// A new model: the same items are updated in place; different ones make a
// new toolbar (a toolbar's items can't be swapped about by identifier)
- (void)update:(NSDictionary *)model {
    NSWindow *w = self.window;
    if (!w) return;
    w.title = S(model, @"title");
    if (@available(macOS 11.0, *)) w.subtitle = S(model, @"subtitle");
    NSMutableArray<NSString *> *ids = [NSMutableArray array];
    NSMutableDictionary *byId = [NSMutableDictionary dictionary];
    for (NSDictionary *m in ([model[@"items"] isKindOfClass:[NSArray class]] ? model[@"items"] : @[])) {
        if (![m isKindOfClass:[NSDictionary class]]) continue;
        if ([S(m, @"kind") isEqualToString:@"flexible"]) { [ids addObject:NSToolbarFlexibleSpaceItemIdentifier]; continue; }
        NSString *ident = S(m, @"id");
        if (!ident.length || byId[ident]) continue;
        [ids addObject:ident];
        byId[ident] = m;
    }
    // A segment's or a menu's kind of item can't change in place either
    BOOL same = [ids isEqualToArray:self.ids ?: @[]];
    for (NSString *ident in byId) if (same && ![S(byId[ident], @"kind") isEqualToString:S(self.model[ident], @"kind")]) same = NO;
    for (NSString *ident in byId) if (same && [S(byId[ident], @"kind") isEqualToString:@"segment"] && ![byId[ident][@"segments"] isEqual:self.model[ident][@"segments"]]) same = NO;
    self.model = byId;
    if (same && self.toolbar) {
        for (NSString *ident in byId) if (self.made[ident]) [self apply:byId[ident] to:self.made[ident]];
    } else {
        self.ids = ids;
        self.made = [NSMutableDictionary dictionary];
        NSToolbar *t = [[NSToolbar alloc] initWithIdentifier:[NSString stringWithFormat:@"jeditor-%ld-%ld", (long)w.windowNumber, (long)++self.generation]];
        t.delegate = self;
        t.displayMode = NSToolbarDisplayModeIconOnly;
        t.allowsUserCustomization = NO;
        t.autosavesConfiguration = NO;
        self.toolbar = t;
        w.toolbar = t;
    }
    w.toolbarStyle = NSWindowToolbarStyleUnified;
    w.titleVisibility = NSWindowTitleVisible;
    self.toolbar.visible = B(model, @"visible", YES);
    EnsureDragView(w);
}

- (NSDictionary *)describe {
    NSMutableArray *items = [NSMutableArray array];
    for (NSToolbarItem *it in self.toolbar.items) {
        NSMutableDictionary *d = [@{ @"id": it.itemIdentifier ?: @"", @"label": it.label ?: @"", @"enabled": @(it.enabled) } mutableCopy];
        if ([it isKindOfClass:[NSMenuToolbarItem class]]) {
            NSMutableArray *menu = [NSMutableArray array];
            for (NSMenuItem *mi in ((NSMenuToolbarItem *)it).menu.itemArray) if (!mi.isSeparatorItem) [menu addObject:[NSString stringWithFormat:@"%@%@", mi.state == NSControlStateValueOn ? @"✓" : @"", mi.title]];
            d[@"menu"] = menu;
        }
        if ([it isKindOfClass:[NSToolbarItemGroup class]]) d[@"selected"] = @(((NSToolbarItemGroup *)it).selectedIndex);
        if ([it isKindOfClass:[NSSearchToolbarItem class]]) d[@"value"] = ((NSSearchToolbarItem *)it).searchField.stringValue ?: @"";
        [items addObject:d];
    }
    return @{ @"title": self.window.title ?: @"", @"subtitle": self.window.subtitle ?: @"", @"visible": @(self.toolbar.visible),
              @"glass": @(NSProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26), @"items": items };
}
@end

// ---- From JS ----

static NSWindow *WindowOf(const Napi::Value &v) {
    if (!v.IsBuffer()) return nil;
    Napi::Buffer<uint8_t> b = v.As<Napi::Buffer<uint8_t>>();
    if (b.Length() < sizeof(void *)) return nil;
    NSView *view = (__bridge NSView *)(*reinterpret_cast<void **>(b.Data()));
    return view.window;
}

static Napi::Value ToJS(Napi::Env env, id v) {
    if ([v isKindOfClass:[NSString class]]) return Napi::String::New(env, [(NSString *)v UTF8String]);
    if ([v isKindOfClass:[NSNumber class]]) {
        if (strcmp([v objCType], @encode(BOOL)) == 0 || CFGetTypeID((__bridge CFTypeRef)v) == CFBooleanGetTypeID()) return Napi::Boolean::New(env, [v boolValue]);
        return Napi::Number::New(env, [v doubleValue]);
    }
    if ([v isKindOfClass:[NSArray class]]) {
        Napi::Array a = Napi::Array::New(env);
        uint32_t i = 0;
        for (id e in (NSArray *)v) a.Set(i++, ToJS(env, e));
        return a;
    }
    if ([v isKindOfClass:[NSDictionary class]]) {
        Napi::Object o = Napi::Object::New(env);
        for (NSString *k in (NSDictionary *)v) o.Set(k.UTF8String, ToJS(env, ((NSDictionary *)v)[k]));
        return o;
    }
    return env.Null();
}

static Napi::Value Supported(const Napi::CallbackInfo &info) {
    return Napi::Boolean::New(info.Env(), NSProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26);
}

static Napi::Value Attach(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    NSWindow *w = WindowOf(info[0]);
    if (!w || !info[1].IsFunction()) return Napi::Boolean::New(env, false);
    if (!controllers) controllers = [NSMapTable weakToStrongObjectsMapTable];
    JEToolbar *t = [controllers objectForKey:w];
    if (t) t.onAction.Release();
    else t = [JEToolbar new];
    t.window = w;
    t.model = [NSMutableDictionary dictionary];
    t.made = [NSMutableDictionary dictionary];
    t.onAction = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "jeditor-toolbar", 0, 1);
    // A toolbar never keeps the app from quitting
    t.onAction.Unref(env);
    if (!t.observers) {
        NSMutableArray *obs = [NSMutableArray array];
        __weak NSWindow *weak = w;
        for (NSNotificationName name in @[NSWindowDidEnterFullScreenNotification, NSWindowDidExitFullScreenNotification]) {
            [obs addObject:[NSNotificationCenter.defaultCenter addObserverForName:name object:w queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *n) {
                if (weak) EnsureDragView(weak);
            }]];
        }
        t.observers = obs;
    }
    [controllers setObject:t forKey:w];
    return Napi::Boolean::New(env, true);
}

static Napi::Value Update(const Napi::CallbackInfo &info) {
    NSWindow *w = WindowOf(info[0]);
    JEToolbar *t = w ? [controllers objectForKey:w] : nil;
    if (!t || !info[1].IsObject()) return Napi::Boolean::New(info.Env(), false);
    [t update:ToObjC(info[1])];
    return Napi::Boolean::New(info.Env(), true);
}

static Napi::Value FocusSearch(const Napi::CallbackInfo &info) {
    NSWindow *w = WindowOf(info[0]);
    JEToolbar *t = w ? [controllers objectForKey:w] : nil;
    for (NSString *ident in t.made) {
        NSToolbarItem *it = t.made[ident];
        if ([it isKindOfClass:[NSSearchToolbarItem class]]) {
            [(NSSearchToolbarItem *)it beginSearchInteraction];
            return Napi::Boolean::New(info.Env(), true);
        }
    }
    return Napi::Boolean::New(info.Env(), false);
}

static Napi::Value Describe(const Napi::CallbackInfo &info) {
    NSWindow *w = WindowOf(info[0]);
    JEToolbar *t = w ? [controllers objectForKey:w] : nil;
    return t ? ToJS(info.Env(), [t describe]) : info.Env().Null();
}

static Napi::Value Click(const Napi::CallbackInfo &info) {
    NSWindow *w = WindowOf(info[0]);
    JEToolbar *t = w ? [controllers objectForKey:w] : nil;
    if (!t || !info[1].IsString()) return Napi::Boolean::New(info.Env(), false);
    NSString *ident = Str(info[1]);
    NSToolbarItem *it = t.made[ident];
    if (!it || !it.enabled) return Napi::Boolean::New(info.Env(), false);
    id value = info.Length() > 2 ? ToObjC(info[2]) : @"";
    if ([it isKindOfClass:[NSToolbarItemGroup class]] && [value isKindOfClass:[NSNumber class]]) {
        ((NSToolbarItemGroup *)it).selectedIndex = [value integerValue];
        [t segmentChosen:(NSToolbarItemGroup *)it];
    } else if ([it isKindOfClass:[NSSearchToolbarItem class]]) {
        ((NSSearchToolbarItem *)it).searchField.stringValue = value ?: @"";
        Send(t, ident, value ?: @"");
    } else {
        Send(t, ident, value ?: @"");
    }
    return Napi::Boolean::New(info.Env(), true);
}

static Napi::Value HitAt(const Napi::CallbackInfo &info) {
    NSWindow *w = WindowOf(info[0]);
    if (!w || !info[1].IsNumber() || !info[2].IsNumber()) return info.Env().Null();
    NSView *frame = w.contentView.superview;
    NSPoint p = NSMakePoint(info[1].As<Napi::Number>().DoubleValue(), w.frame.size.height - info[2].As<Napi::Number>().DoubleValue());
    NSMutableArray *chain = [NSMutableArray array];
    for (NSView *v = [frame hitTest:[frame convertPoint:p fromView:nil]]; v && v != frame; v = v.superview) [chain addObject:NSStringFromClass([v class])];
    return ToJS(info.Env(), chain);
}

static Napi::Value Detach(const Napi::CallbackInfo &info) {
    NSWindow *w = WindowOf(info[0]);
    JEToolbar *t = w ? [controllers objectForKey:w] : nil;
    if (t) {
        for (id o in t.observers) [NSNotificationCenter.defaultCenter removeObserver:o];
        t.observers = nil;
        t.onAction.Release();
        w.toolbar = nil;
        [controllers removeObjectForKey:w];
    }
    return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("supported", Napi::Function::New(env, Supported));
    exports.Set("attach", Napi::Function::New(env, Attach));
    exports.Set("update", Napi::Function::New(env, Update));
    exports.Set("focusSearch", Napi::Function::New(env, FocusSearch));
    exports.Set("describe", Napi::Function::New(env, Describe));
    exports.Set("click", Napi::Function::New(env, Click));
    exports.Set("hitAt", Napi::Function::New(env, HitAt));
    exports.Set("detach", Napi::Function::New(env, Detach));
    return exports;
}

NODE_API_MODULE(toolbar, Init)
