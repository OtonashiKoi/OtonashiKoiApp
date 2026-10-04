from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
from scipy import ndimage as nd
import json,hashlib
import argparse
parser=argparse.ArgumentParser(description='Create transparent item candidates from a verified originals backup; never modify live assets.')
parser.add_argument('--backup',type=Path,required=True)
base=parser.parse_args().backup
out=base/'processed';out.mkdir(exist_ok=True)
exclude={'49b41cc9-5','4d7ec2f4-a','7807e844','7a4c2196','94da385c','bbfa5d83','7a4c2'}
rows=[];changed=[]
for p in sorted((base/'originals').iterdir()):
 im=Image.open(p).convert('RGBA');a=np.array(im);rgb=a[:,:,:3].astype(float);h,w=rgb.shape[:2]
 if a[:,:,3].min()<255:rows.append({'file':p.name,'state':'already-transparent'});continue
 if any(p.stem.startswith(k) for k in exclude):rows.append({'file':p.name,'state':'illustration-preserved'});continue
 if rgb.max()<45:rows.append({'file':p.name,'state':'no-visible-subject'});continue
 # Estimate the background from the perimeter; preserve original RGB exactly.
 edge=np.concatenate((rgb[0],rgb[-1],rgb[:,0],rgb[:,-1]));median=np.median(edge,axis=0)
 white=median.min()>190
 if white:
  bg=(rgb.min(axis=2)>220)&((rgb.max(axis=2)-rgb.min(axis=2))<28)
 elif median[2]>median[0]+25 and median[2]>55:
  # Violet egg backing, including its gradient.
  bg=(rgb[:,:,2]>rgb[:,:,0]*1.35)&(rgb[:,:,2]>rgb[:,:,1]*1.3)&(rgb[:,:,0]<100)&(rgb[:,:,1]<85)
 elif not p.name.startswith('gen-'):
  bg=(rgb.max(axis=2)<68)&((rgb.max(axis=2)-rgb.min(axis=2))<32)
 else:
  bg=((rgb.max(axis=2)<68)&((rgb[:,:,2]-rgb[:,:,0])>3)&((rgb.max(axis=2)-rgb.min(axis=2))<32)) | (rgb.max(axis=2)<8)
 fg=~bg
 # Ignore background noise, then retain a one-pixel dark outline around the art.
 labels,n=nd.label(fg);sizes=np.bincount(labels.ravel());keep=sizes>=max(2,w*h*0.00007);keep[0]=False
 for label,sl in enumerate(nd.find_objects(labels),1):
  if sl is None:continue
  hh=sl[0].stop-sl[0].start;ww=sl[1].stop-sl[1].start
  if (ww>w*.85 or hh>h*.85) and sizes[label]<w*h*.08:keep[label]=False
 fg=keep[labels]
 outline=max(1,round(min(w,h)/256));fg=nd.binary_dilation(fg,iterations=outline)
 trim=max(2,round(min(w,h)*.045)) if p.name.startswith('gen-') and not white else (1 if white else 2)
 fg[:trim,:]=False;fg[-trim:,:]=False;fg[:,:trim]=False;fg[:,-trim:]=False
 coverage=float(fg.mean())
 if not .005<coverage<.85:rows.append({'file':p.name,'state':'review-required','coverage':coverage});continue
 a[:,:,3]=np.where(fg,255,0).astype('uint8');result=Image.fromarray(a)
 target=out/p.name
 if p.suffix.lower()=='.webp':result.save(target,format='WEBP',lossless=True)
 else:result.save(target,format='PNG')
 reopened=np.array(Image.open(target).convert('RGBA'));assert np.array_equal(reopened[:,:,:3][fg],np.array(im)[:,:,:3][fg]);assert reopened[:,:,3].min()==0
 rows.append({'file':p.name,'state':'processed','coverage':round(coverage,4),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()});changed.append(target)
(base/'processing-manifest.json').write_text(json.dumps(rows,indent=2))
for j in range(0,len(changed),50):
 sheet=Image.new('RGB',(1000,600),'#c7bdd5');d=ImageDraw.Draw(sheet)
 for i,p in enumerate(changed[j:j+50]):
  im=Image.open(p).convert('RGBA');im.thumbnail((90,90));x=i%10*100;y=i//10*120;sheet.paste(im,(x,y),im);d.text((x,y+92),str(j+i)+' '+p.stem[:10],fill='black')
 sheet.save(base/f'cutouts-{j//50}.jpg')
from collections import Counter
print(Counter(r['state'] for r in rows))
