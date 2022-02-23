import { Emulators } from "../../emulator/types";
import { determineTargetConfig, startEmulator } from "../../emulator/controller";
import { EmulatorRegistry } from "../../emulator/registry";
import { expect } from "chai";
import { FakeEmulator } from "./fakeEmulator";
import { Config } from "../../config";
import { Options } from "../../options";

describe("EmulatorController", () => {
  afterEach(async () => {
    await EmulatorRegistry.stopAll();
  });

  it("should start and stop an emulator", async () => {
    const name = Emulators.FUNCTIONS;

    expect(EmulatorRegistry.isRunning(name)).to.be.false;

    await startEmulator(new FakeEmulator(name, "localhost", 7777));

    expect(EmulatorRegistry.isRunning(name)).to.be.true;
    expect(EmulatorRegistry.getPort(name)).to.eql(7777);
  });

  describe("determineTargetConfig", () => {
    it("should return the specified target", () => {
      const config = new Config("path/to", {});
      config.set("storage", { target: "default", rules: "storage.rules" });
      expect(
        determineTargetConfig(Emulators.STORAGE, {
          config,
        } as Options)
      ).to.deep.equal({ target: "default", rules: "storage.rules" });
    });
    it("should return the default target", () => {
      const config = new Config("path/to", {});
      config.set("storage", [
        { target: "default", rules: "storage.rules" },
        { target: "test", rules: "storage.test.rules" },
      ]);
      expect(
        determineTargetConfig(Emulators.STORAGE, {
          config,
          only: "firestore:default,storage:default",
        } as Options)
      ).to.deep.equal({ target: "default", rules: "storage.rules" });
    });
    it("should return the test target", () => {
      const config = new Config("path/to", {});
      config.set("storage", [
        { target: "default", rules: "storage.rules" },
        { target: "test", rules: "storage.test.rules" },
      ]);
      expect(
        determineTargetConfig(Emulators.STORAGE, {
          config,
          only: "firestore:default,storage:test",
        } as Options)
      ).to.deep.equal({ target: "test", rules: "storage.test.rules" });
    });
    it("should return the default target if --only does not have a setting that contains emulatorName", () => {
      const config = new Config("path/to", {});
      config.set("storage", [
        { target: "default", rules: "storage.rules" },
        { target: "test", rules: "storage.test.rules" },
      ]);
      expect(
        determineTargetConfig(Emulators.STORAGE, {
          config,
          only: "firestore:default",
        } as Options)
      ).to.deep.equal({ target: "default", rules: "storage.rules" });
    });
    it("should return the default target if the --only option does not exist.", () => {
      const config = new Config("path/to", {});
      config.set("storage", [
        { target: "default", rules: "storage.rules" },
        { target: "test", rules: "storage.test.rules" },
      ]);
      expect(
        determineTargetConfig(Emulators.STORAGE, {
          config,
        } as Options)
      ).to.deep.equal({ target: "default", rules: "storage.rules" });
    });
    it("should return undefined if the target specified in --only does not exist", () => {
      const config = new Config("path/to", {});
      config.set("storage", [
        { target: "default", rules: "storage.rules" },
        { target: "test", rules: "storage.test.rules" },
      ]);
      expect(
        determineTargetConfig(Emulators.STORAGE, {
          config,
          only: "storage:doesnotexist",
        } as Options)
      ).to.be.undefined;
    });
  });
});
