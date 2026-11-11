#!/usr/bin/env python3
"""Prepare verified offline WorkOS sources and authored web assets for a local iOS build."""
import argparse,hashlib,json,pathlib,shutil,subprocess,tarfile
from distribution_safety import validate_dist
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--sdk',choices=['iphoneos','iphonesimulator'],default='iphonesimulator');args=p.parse_args()
build=ROOT/'build'/('workos-mobile-'+args.sdk);build.mkdir(parents=True,exist_ok=True)
manifest=json.loads((ROOT/'vendor-src/workos-ios/SOURCE.json').read_text());archive=ROOT/'vendor-src/workos-ios/sources.tar.gz'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==manifest['archiveSHA256']
source=build/'source';source.mkdir(exist_ok=True)
with tarfile.open(archive) as package:
    members=package.getmembers();assert len(members)==len(manifest['files'])
    for member in members:
        path=pathlib.PurePosixPath(member.name);assert member.isfile() and not path.is_absolute() and '..' not in path.parts
        data=package.extractfile(member).read();assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==manifest['files'][member.name]
        target=source/member.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
sdk=subprocess.check_output(['xcrun','--sdk',args.sdk,'--show-sdk-path'],text=True).strip();target='arm64-apple-ios18.0'+('-simulator' if args.sdk=='iphonesimulator' else '')
identity=manifest['archiveSHA256']+'\n'+target+'\n'+subprocess.check_output(['xcrun','swiftc','--version'],text=True)+sdk
receipt=build/'identity'
if not receipt.exists() or receipt.read_text()!=identity or not (build/'libWorkOS.a').is_file() or not (build/'WorkOS.swiftmodule').is_file():
    paths=sorted(source/name for name in manifest['files'] if name.startswith('Sources/WorkOS/') and name.endswith('.swift'));response=build/'sources.rsp';response.write_text('\n'.join('"'+str(x)+'"' for x in paths)+'\n')
    subprocess.run(['xcrun','swiftc','-O','-whole-module-optimization','-parse-as-library','-emit-module','-emit-library','-static','-module-name','WorkOS','-sdk',sdk,'-target',target,'-emit-module-path',str(build/'WorkOS.swiftmodule'),'-o',str(build/'libWorkOS.a'),'@'+str(response)],check=True);receipt.write_text(identity)
validate_dist(ROOT/'dist');assets=ROOT/'build/ios-assets';web=assets/'dist'
# This task-owned generated tree is rebuilt from validated source, never overlaid with stale assets.
if web.exists():shutil.rmtree(web)
web.mkdir(parents=True,exist_ok=True)
for path in (ROOT/'dist').rglob('*'):
    relative=path.relative_to(ROOT/'dist')
    if any(part.startswith('.') or part=='downloads' for part in relative.parts):continue
    if path.is_file():
        target=web/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
script="const fs=require('fs'),vm=require('vm');const c={TextEncoder,crypto:require('crypto').webcrypto,URL};vm.runInNewContext(fs.readFileSync('dist/workspace-storage-model.js','utf8'),c);process.stdout.write(JSON.stringify(c.OpenSesameWorkspaceStorageModel.allowed))"
keys=subprocess.check_output(['node','-e',script],cwd=ROOT);(assets/'workspace-keys.json').write_bytes(keys)
print('Verified pinned SDK '+manifest['revision']+' and prepared authored renderer; no account or signing settings changed.')
