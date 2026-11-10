import math
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diarization_worker import segments

class DiarizationTests(unittest.TestCase):
    def test_valid_overlap_and_anonymous_labels(self):
        result = segments(['0.1 1.8 speaker_0', '1.0 2.0 speaker_1'], 2)
        self.assertEqual([row['speaker'] for row in result], [0, 1])
        self.assertLess(result[1]['start'], result[0]['end'])
    def test_rejects_nonfinite_inverted_and_unknown_speakers(self):
        for row in ['nan 1 speaker_0', '0 inf speaker_0', '2 1 speaker_0', '0 1 speaker_4', '0 1 private-name', '0 99 speaker_0']:
            with self.subTest(row=row), self.assertRaises(ValueError): segments([row], 2)
