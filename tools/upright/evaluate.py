# How well it does on the 2,000 test photos it never saw, each aged and turned
# all four ways, reading them as upright.js does (all four turns put together),
# and what each "sure" threshold would do.
import numpy as np, torch, torch.nn.functional as F
from train import Net, batch, test_idx, turn, dev, age, MEAN, STD, S, photos

net = Net().to(dev)
import sys
net.load_state_dict(torch.load(sys.argv[1] if len(sys.argv) > 1 else 'upright.pt', map_location=dev))
net.eval()
torch.manual_seed(5)
P, K = [], []
with torch.no_grad():
    for s in range(0, len(test_idx), 200):
        ids = test_idx[s:s + 200]
        a = torch.from_numpy(np.stack([photos[i] for i in ids])).to(dev).permute(0, 3, 1, 2).float() / 255
        a = F.interpolate(a, size=(S, S), mode='bilinear', antialias=True, align_corners=False)
        a = age(a)
        for k in range(4):
            x = turn(a, torch.full((len(ids),), k, device=dev))
            p = torch.zeros(len(ids), 4, device=dev)
            img = x
            for r in range(4):
                q = F.softmax(net((img - MEAN.to(dev)) / STD.to(dev)), 1)
                p += torch.roll(q, -r, 1) / 4  # p[k] += q[(k + r) % 4]
                img = torch.rot90(img, 1, (2, 3))
            P.append(p.cpu()); K.append(torch.full((len(ids),), k))
P, K = torch.cat(P), torch.cat(K)
# the same, only for the photos with people in them (closer to family prints)
ids_all = open('ids.txt').read().split('\n')
people = set(open('people.txt').read().split('\n'))
mask = torch.tensor([ids_all[i] in people for i in test_idx])
mask = torch.cat([mask[s:s + 200].repeat(4) for s in range(0, len(test_idx), 200)])
def report(P, K, name):
    sure, pred = P.max(1)
    print(f'{name}: plain accuracy {(pred == K).float().mean():.4f} ({len(K) // 4} photos)')
    for t in [0.5, 0.6, 0.7, 0.8, 0.9]:
        act = torch.where(sure >= t, pred, torch.zeros_like(pred))
        print(f'  sure >= {t:.2f}: ends upright {(act == K).float().mean():.4f}, turned wrongly {((act != 0) & (act != K)).float().mean():.4f}')
report(P, K, 'all')
report(P[mask], K[mask], 'with people')
raise SystemExit
sure, pred = P.max(1)
print(f'plain accuracy (all four turns): {(pred == K).float().mean():.4f}')
for t in [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]:
    act = torch.where(sure >= t, pred, torch.zeros_like(pred))  # unsure: left as it is
    right = (act == K).float().mean()
    wrong_turn = ((act != 0) & (act != K)).float().mean()
    left_wrong = ((act == 0) & (K != 0)).float().mean()
    print(f'sure >= {t:.2f}: ends upright {right:.4f}, turned wrongly {wrong_turn:.4f}, left needing a turn {left_wrong:.4f}')
