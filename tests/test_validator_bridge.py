import importlib.util
import json
import pathlib
import tempfile
import types
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "src" / "server.py"


def load_server_module():
    spec = importlib.util.spec_from_file_location("mapmaker_validator_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ValidatorBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = load_server_module()

    def test_project_root_and_schema_are_inferred_from_configured_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            content = root / "Assets" / "StreamingAssets"
            maps = content / "Maps"
            tools = root / "Tools"
            maps.mkdir(parents=True)
            tools.mkdir()
            (tools / "content.cmd").write_text("@echo off\n", encoding="utf-8")
            (content / "config-manifest.json").write_text(json.dumps({
                "schemaVersion": 2,
                "configVersion": "test",
                "validationMode": "development",
                "gameplayFiles": ["Maps/Test.json"],
            }), encoding="utf-8")
            with mock.patch.object(self.server, "MAPS_DIR", str(maps)), \
                    mock.patch.object(self.server, "ENEMY_FILE", str(content / "EnemyUnits.json")), \
                    mock.patch.object(self.server, "MAP_THEMES_FILE", str(content / "MapThemes.json")):
                context = self.server.project_context()
            self.assertEqual(str(root), context["projectRoot"])
            self.assertEqual(2, context["schemaVersion"])
            self.assertIn("Maps/Test.json", context["trackedFiles"])

    def test_shared_cli_result_is_exposed_as_authoritative_status(self):
        context = {
            "projectRoot": "P:/Ionia", "contentRoot": "P:/Ionia/Assets/StreamingAssets",
            "command": "P:/Ionia/Tools/content.cmd", "schemaVersion": 2,
            "configVersion": "phase4", "mode": "development",
            "trackedFiles": {"Maps/Test.json"},
        }
        completed = types.SimpleNamespace(returncode=0, stdout="Build succeeded.\n" + json.dumps({
            "success": True, "diagnostics": []}) + "\n", stderr="")
        with mock.patch.object(self.server, "project_context", return_value=context), \
                mock.patch.object(self.server.subprocess, "run", return_value=completed):
            result = self.server.validate_project("P:/Ionia/Assets/StreamingAssets/Maps/Test.json")
        self.assertTrue(result["available"])
        self.assertTrue(result["success"])
        self.assertTrue(result["tracked"])
        self.assertTrue(result["legal"])
        self.assertEqual("mapmaker-v1", result["editorSchema"])

    def test_cli_json_is_extracted_after_build_output(self):
        payload = self.server.parse_cli_payload(
            "  Ionia.Core -> bin/Debug\n" + json.dumps({"success": True, "diagnostics": []}))
        self.assertTrue(payload["success"])

    def test_invalid_tracked_candidate_is_rolled_back_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "Test.json"
            target.write_bytes(b"original\r\n")
            validation = {"available": True, "tracked": True, "success": False,
                          "legal": False, "diagnostics": [{"code": "CONTENT_REF_MISSING"}]}
            with mock.patch.object(self.server, "validate_project", return_value=validation):
                saved, result = self.server.write_with_project_validation(
                    str(target), "candidate\n")
            self.assertFalse(saved)
            self.assertEqual(validation, result)
            self.assertEqual(b"original\r\n", target.read_bytes())

    def test_untracked_candidate_is_kept_as_non_authoritative_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "NewMap.json"
            validation = {"available": True, "tracked": False, "success": True,
                          "legal": False, "diagnostics": []}
            with mock.patch.object(self.server, "validate_project", return_value=validation):
                saved, result = self.server.write_with_project_validation(
                    str(target), "candidate\n")
            self.assertTrue(saved)
            self.assertFalse(result["legal"])
            self.assertEqual("candidate\n", target.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
