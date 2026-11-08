import base64
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zlib
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import familiar_avatars as avatars
from coven_runtime import CovenRuntime


def image(width=2,height=2):
    def chunk(kind,payload):return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
    raw=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\x80\x40\xff\xff'*width)*height))+chunk(b'IEND',b'')
    return 'data:image/png;base64,'+base64.b64encode(raw).decode()

class FamiliarAvatarTests(unittest.TestCase):
    def test_cave_filename_preference(self):
        self.assertEqual(avatars.pick_avatar(['other.png','NOVA.jpg','nova.webp','nova.png'],'nova'),'nova.png')
        self.assertEqual(avatars.pick_avatar(['z.png','a.jpg'],'nova'),'a.jpg')
        self.assertIsNone(avatars.pick_avatar(['IDENTITY.md','image.svg'],'nova'))

    def test_explicit_save_uses_workspace_default_without_other_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'IDENTITY.md').write_text('Keep identity unchanged')
            encoded=image();result=avatars.write_avatar(root,'nova',encoded)
            self.assertTrue(result.startswith('data:image/png;base64,'))
            self.assertEqual((root/'avatars/nova.png').read_bytes(),avatars.png_bytes(encoded))
            self.assertEqual((root/'IDENTITY.md').read_text(),'Keep identity unchanged')
            self.assertFalse(list((root/'avatars').glob('*.tmp')))
            self.assertEqual(os.stat(root/'avatars/nova.png').st_mode&0o777,0o600)
            self.assertTrue(avatars.load_avatar(root,'nova'))

    def test_symbolic_avatar_folder_and_destination_are_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);outside=root/'outside';outside.mkdir();home=root/'home';home.mkdir();(home/'avatars').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):avatars.write_avatar(home,'nova',image())
            self.assertEqual(list(outside.iterdir()),[])
            (home/'avatars').unlink();(home/'avatars').mkdir();target=outside/'keep.png';target.write_bytes(b'keep');(home/'avatars/nova.png').symlink_to(target)
            with self.assertRaises(ValueError):avatars.write_avatar(home,'nova',image())
            self.assertEqual(target.read_bytes(),b'keep')
            self.assertEqual(avatars.load_avatar(home,'nova'),'')

    def test_invalid_identity_and_corrupt_payload_never_create_avatar_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            for fid,payload in [('../other',image()),('nova','data:image/svg+xml;base64,PHN2Zz4='),('nova',image()[:-5]+'AAAAA'),('nova',image(1025,1))]:
                with self.subTest(fid=fid):
                    with self.assertRaises(ValueError):avatars.write_avatar(folder,fid,payload)
            self.assertEqual(list(Path(folder).iterdir()),[])

    def test_existing_avatar_load_is_read_only_and_ignores_private_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'avatars').mkdir();p=root/'avatars/nova.png';p.write_bytes(avatars.png_bytes(image()));before=p.read_bytes();(root/'avatars/secret.env').write_text('fixture-secret')
            result=avatars.load_avatar(root,'nova');self.assertTrue(result.startswith('data:image/png;base64,'));self.assertNotIn('fixture-secret',result);self.assertEqual(p.read_bytes(),before)
