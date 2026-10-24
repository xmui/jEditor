# Trains jEditor's "Turn upright" model: which of four turns puts a photo
# upright. Our own network, trained from scratch on Open Images (CC BY 2.0)
# photos that are upright, each shown turned 0/90/180/270 degrees, aged to
# look like scanned prints (fading, casts, black and white, borders, grain).
import math, sys, time, numpy as np, torch, torch.nn as nn, torch.nn.functional as F

torch.manual_seed(1)
np.random.seed(1)
dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
S = 96  # the network's input
import os
DATA = os.environ.get('DATA', '.')  # where the photos are (the T7: /Volumes/T7 2/autorotate)
CH = [int(v) for v in os.environ.get('CH', '32,64,96,128').split(',')]
DEPTH = int(os.environ.get('DEPTH', '2'))  # convolutions per size
HID = 128
SQ = 32

# The validation set's photos (A); with MORE=1, the test set's too (B), for
# training only. The 2,000 + 2,000 kept back always come from A.
A = np.load(os.path.join(DATA, 'photos128.npy'), mmap_mode='r')
ok = np.load(os.path.join(DATA, 'ok.npy'))
idx = np.flatnonzero(ok)
rng = np.random.default_rng(7)
rng.shuffle(idx)
test_idx, val_idx, train_idx = idx[:2000], idx[2000:4000], idx[4000:]
NA = len(A)
B = C = None
NB = 0
if os.environ.get('MORE'):
    B = np.load(os.path.join(DATA, 'photos128b.npy'), mmap_mode='r')
    NB = len(B)
    train_idx = np.concatenate([train_idx, NA + np.flatnonzero(np.load(os.path.join(DATA, 'okb.npy')))])
# MORE=2: Open Images' train set too (C, 300,000 photos)
if os.environ.get('MORE') == '2':
    C = np.load(os.path.join(DATA, 'photos128c.npy'), mmap_mode='r')
    train_idx = np.concatenate([train_idx, NA + NB + np.flatnonzero(np.load(os.path.join(DATA, 'okc.npy')))])


class Photos:
    def __getitem__(self, i):
        return A[i] if i < NA else B[i - NA] if i < NA + NB else C[i - NA - NB]


photos = Photos()
print('train', len(train_idx), 'val', len(val_idx), 'test', len(test_idx), flush=True)


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        layers, c = [], 3
        for o in CH:
            layers += [nn.Conv2d(c, o, 3, 2, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU()]
            for _ in range(DEPTH - 1):
                layers += [nn.Conv2d(o, o, 3, 1, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU()]
            c = o
        layers += [nn.Conv2d(c, SQ, 1, bias=False), nn.BatchNorm2d(SQ), nn.ReLU()]
        self.conv = nn.Sequential(*layers)  # 96 -> 6, then SQ channels
        self.fc1 = nn.Linear(SQ * 6 * 6, HID)
        self.drop = nn.Dropout(0.3)
        self.fc2 = nn.Linear(HID, 4)

    def forward(self, x):
        x = self.conv(x).flatten(1)
        return self.fc2(self.drop(F.relu(self.fc1(x))))


# ---- Making a photo look like a scanned print (on the GPU, a batch at a time) ----

def age(x):
    """x: B,3,H,W in 0..1, upright. Returns aged copies, still upright."""
    B = x.shape[0]
    r = lambda *s: torch.rand(*s, device=x.device)
    # mirror (still upright)
    flip = r(B) < 0.5
    x = torch.where(flip[:, None, None, None], x.flip(3), x)
    # a slightly different crop and scale
    sc = 0.85 + 0.15 * r(B)
    tx, ty = (1 - sc) * (r(B) * 2 - 1), (1 - sc) * (r(B) * 2 - 1)
    ang = (r(B) * 2 - 1) * math.radians(4)
    cos, sin = torch.cos(ang) * sc, torch.sin(ang) * sc
    theta = torch.stack([torch.stack([cos, -sin, tx], 1), torch.stack([sin, cos, ty], 1)], 1)
    grid = F.affine_grid(theta, (B, 3, S, S), align_corners=False)
    x = F.grid_sample(x, grid, padding_mode='reflection', align_corners=False)
    # black and white, sometimes
    gray = (x * torch.tensor([0.299, 0.587, 0.114], device=x.device)[None, :, None, None]).sum(1, keepdim=True)
    bw = r(B) < 0.2
    x = torch.where(bw[:, None, None, None], gray.expand_as(x), x)
    # faded: toward a warm or cyan cast, lower contrast
    fade = (r(B) < 0.5).float() * r(B) * 0.5
    cast = torch.stack([0.9 + 0.2 * r(B), 0.8 + 0.2 * r(B), 0.55 + 0.4 * r(B)], 1)
    cast = torch.where((r(B) < 0.3)[:, None], cast.flip(1), cast)
    x = x * (1 - fade[:, None, None, None]) + cast[:, :, None, None] * fade[:, None, None, None] * (0.6 + 0.4 * gray)
    # brightness, contrast, colour
    x = (x - 0.5) * (0.7 + 0.6 * r(B, 1, 1, 1)) + 0.5 + (r(B, 1, 1, 1) - 0.5) * 0.3
    x = x * (0.85 + 0.3 * r(B, 3, 1, 1))
    # grain
    x = x + torch.randn_like(x) * 0.04 * r(B, 1, 1, 1)
    # vignette, sometimes
    yy, xx = torch.meshgrid(torch.linspace(-1, 1, S, device=x.device), torch.linspace(-1, 1, S, device=x.device), indexing='ij')
    v = 1 - (r(B, 1, 1, 1) < 0.3).float() * 0.35 * r(B, 1, 1, 1) * (xx ** 2 + yy ** 2)[None, None]
    x = x * v
    # a border: white all round (a print's), or an instant photo's (thick at the bottom)
    kind = r(B)
    bord = torch.zeros(B, 1, S, S, device=x.device)
    t = (2 + 8 * r(B)).long()
    for i in range(B):
        k, w = kind[i].item(), t[i].item()
        if k < 0.2:
            bord[i, :, :w] = bord[i, :, -w:] = bord[i, :, :, :w] = bord[i, :, :, -w:] = 1
        elif k < 0.3:
            b = w + 8 + int(6 * torch.rand(1).item())
            bord[i, :, :w] = bord[i, :, -b:] = bord[i, :, :, :w] = bord[i, :, :, -w:] = 1
    paper = 0.85 + 0.15 * r(B, 3, 1, 1)
    x = x * (1 - bord) + paper * bord
    return x.clamp(0, 1)


def turn(x, k):
    """Turn each image by k[i] quarter turns counter-clockwise."""
    out = torch.empty_like(x)
    for q in range(4):
        m = k == q
        if m.any():
            out[m] = torch.rot90(x[m], q, (2, 3))
    return out


MEAN = torch.tensor([0.45, 0.43, 0.40]).view(1, 3, 1, 1)
STD = torch.tensor([0.27, 0.26, 0.27]).view(1, 3, 1, 1)


def batch(ids, aug):
    a = torch.from_numpy(np.stack([photos[i] for i in ids])).to(dev).permute(0, 3, 1, 2).float() / 255
    a = F.interpolate(a, size=(S, S), mode='bilinear', antialias=True, align_corners=False)
    if aug:
        a = age(a)
    k = torch.randint(0, 4, (len(ids),), device=dev)
    return ((turn(a, k) - MEAN.to(dev)) / STD.to(dev)), k


@torch.no_grad()
def evaluate(net, ids, aug=True):
    net.eval()
    torch.manual_seed(123)
    right = n = 0
    for s in range(0, len(ids), 256):
        x, k = batch(ids[s:s + 256], aug)
        right += (net(x).argmax(1) == k).sum().item()
        n += len(k)
    return right / n


if __name__ == '__main__':
    epochs = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    net = Net().to(dev)
    print('params', sum(p.numel() for p in net.parameters()), flush=True)
    opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
    steps = epochs * (len(train_idx) // 128)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=steps)
    best = 0
    for ep in range(epochs):
        net.train()
        order = np.random.permutation(train_idx)
        t0, tot = time.time(), 0
        for s in range(0, len(order) - 127, 128):
            x, k = batch(np.sort(order[s:s + 128]), True)
            loss = F.cross_entropy(net(x), k, label_smoothing=0.05)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item()
        acc = evaluate(net, val_idx)
        print(f'epoch {ep} loss {tot / (len(order) // 128):.3f} val {acc:.4f} {time.time() - t0:.0f}s', flush=True)
        if acc > best:
            best = acc
            torch.save(net.state_dict(), os.environ.get('OUT', 'upright.pt'))
    print('best val', best)
