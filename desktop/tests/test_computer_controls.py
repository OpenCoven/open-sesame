import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from computer_controls import control

class ComputerControlsTests(unittest.TestCase):
    @patch('computer_controls.sys.platform', 'darwin')
    @patch('computer_controls.subprocess.run')
    def test_allowlisted_controls(self, run):
        run.return_value.returncode = 0
        for action, value, command in [
            ('volume', 40, ['/usr/bin/osascript', '-e', 'set volume output volume 40']),
            ('mute', True, ['/usr/bin/osascript', '-e', 'set volume output muted true']),
            ('open', 'safari', ['/usr/bin/open', '-b', 'com.apple.Safari'])]:
            self.assertTrue(control({'action': action, 'value': value})['completed'])
            self.assertEqual(run.call_args.args[0], command)
            self.assertNotIn('shell', run.call_args.kwargs)

    @patch('computer_controls.sys.platform', 'darwin')
    @patch('computer_controls.subprocess.run')
    def test_untrusted_values_never_reach_process(self, run):
        for params in [{'action':'volume','value':'40; shutdown'}, {'action':'volume','value':True},
                       {'action':'volume','value':101}, {'action':'open','value':'Safari; rm -rf ~'},
                       {'action':'type','value':'anything'}, {'action':'mute','value':'true'}]:
            with self.assertRaises(ValueError): control(params)
        run.assert_not_called()

    @patch('computer_controls.sys.platform', 'linux')
    def test_other_platforms_report_unavailable(self):
        with self.assertRaisesRegex(ValueError, 'macOS'): control({'action':'mute','value':True})
