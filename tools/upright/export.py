# Writes app/upright-model.js: the trained network with its batch norms
# folded into the convolutions, as half floats in base64.
import base64, json, sys, numpy as np, torch
from train import Net, MEAN, STD, S

net = Net()
net.load_state_dict(torch.load(sys.argv[1] if len(sys.argv) > 1 else 'upright.pt', map_location='cpu'))
net.eval()
mods = list(net.conv)
blobs, layers, at = [], [], 0

def put(a):
    global at
    a = np.ascontiguousarray(a, dtype=np.float16).ravel()
    blobs.append(a)
    at += a.size
    return [at - a.size, a.size]

for i in range(0, len(mods), 3):
    conv, bn = mods[i], mods[i + 1]
    s = (bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach()
    w = (conv.weight.detach() * s[:, None, None, None]).numpy()
    b = (bn.bias.detach() - bn.running_mean * s).numpy()
    layers.append({'kind': 'conv', 'cin': conv.in_channels, 'cout': conv.out_channels, 'k': conv.kernel_size[0], 'stride': conv.stride[0], 'w': put(w), 'b': put(b)})
for fc, relu in ((net.fc1, True), (net.fc2, False)):
    layers.append({'kind': 'dense', 'cin': fc.in_features, 'cout': fc.out_features, 'relu': relu, 'w': put(fc.weight.detach().numpy()), 'b': put(fc.bias.detach().numpy())})

data = base64.b64encode(np.concatenate(blobs).tobytes()).decode()
model = {'size': S, 'mean': MEAN.ravel().tolist(), 'std': STD.ravel().tolist(), 'layers': layers}
head = json.dumps(model, separators=(',', ':'))
out = sys.argv[2] if len(sys.argv) > 2 else 'upright-model.js'
with open(out, 'w') as f:
    f.write('// Turn upright\'s network (upright.js), made by tools/upright/export.py:\n')
    f.write('// our own, trained from scratch on Open Images photos (CC BY 2.0)\n')
    f.write('const UPRIGHT_MODEL = ' + head[:-1] + ',"data":"' + data + '"};\n')
print(out, len(data) // 1024, 'KB of weights')
