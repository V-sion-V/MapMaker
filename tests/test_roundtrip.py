import copy
import hashlib
import importlib.util
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE_DIR = pathlib.Path(__file__).resolve().parent / "fixtures" / "v1"
SERVER_PATH = ROOT / "src" / "server.py"


def load_server_module():
    spec = importlib.util.spec_from_file_location("mapmaker_server_under_test", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def semantic_hash(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class V1RoundTripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = load_server_module()
        with (FIXTURE_DIR / "fixture-manifest.json").open(encoding="utf-8") as stream:
            cls.manifest = json.load(stream)

    def load_fixture(self):
        with (FIXTURE_DIR / self.manifest["mapFile"]).open(encoding="utf-8-sig") as stream:
            return json.load(stream)

    def test_authoritative_fixture_has_expected_semantics(self):
        value = self.load_fixture()
        self.assertEqual(self.manifest["mapName"], value["mapName"])
        self.assertEqual(value["width"] * value["height"], len(value["tiles"]))
        self.assertEqual(self.manifest["formationCount"], len(value["enemyPresets"]))
        self.assertEqual(self.manifest["semanticSha256"], semantic_hash(value))
        for preset in value["enemyPresets"]:
            self.assertGreaterEqual(preset["weight"], 0)
            occupied = {(enemy["x"], enemy["y"]) for enemy in preset["enemies"]}
            self.assertEqual(len(preset["enemies"]), len(occupied))
            for enemy in preset["enemies"]:
                self.assertNotIn("levelUp", enemy)

    def test_format_map_round_trip_preserves_all_fields(self):
        original = self.load_fixture()
        before = copy.deepcopy(original)
        serialized = self.server.format_map(original)
        reparsed = json.loads(serialized)
        self.assertEqual(before, original, "format_map must not mutate editor state")
        self.assertEqual(before, reparsed)
        self.assertEqual(semantic_hash(before), semantic_hash(reparsed))

    def test_format_map_is_canonical_and_idempotent(self):
        original = self.load_fixture()
        first = self.server.format_map(original)
        second = self.server.format_map(json.loads(first))
        self.assertEqual(first, second)
        self.assertTrue(first.endswith("\n"))

    def test_unknown_fields_survive_round_trip(self):
        original = self.load_fixture()
        original["futureEditorMetadata"] = {"collapsed": True}
        reparsed = json.loads(self.server.format_map(original))
        self.assertEqual({"collapsed": True}, reparsed["futureEditorMetadata"])


if __name__ == "__main__":
    unittest.main()
