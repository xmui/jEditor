import json, os, subprocess, sys, numpy as np, torch
from train import Net, S
net = Net(); net.load_state_dict(torch.load(os.environ.get('PT', 'upright.pt'), map_location='cpu')); net.eval()
x = torch.randn(1, 3, S, S)
json.dump(x.ravel().tolist(), open('parity-in.json', 'w'))
with torch.no_grad(): ref = net(x)[0].numpy()
js = subprocess.run(['node', 'parity.js', sys.argv[1], sys.argv[2]], capture_output=True, text=True).stdout.split(' ')[0]
js = np.array(json.loads(js))
print('torch', ref.round(4), '\njs   ', js.round(4), '\nmax diff', abs(ref - js).max())
