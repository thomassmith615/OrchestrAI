import { describe, expect, it } from "vitest";
import {
  createCapabilityStorage,
  StorageContainmentError,
  storageRoot,
} from "../../src/runtime/storage.js";
import { fakeFileSystem } from "../support/fakes.js";
import type { RepositoryScope, UserScope } from "../../src/core/workspace.js";

const repoScope: RepositoryScope = {
  kind: "repository",
  workspace: {
    root: "/repo",
    stateDir: "/repo/.orchestrai",
    configPath: "/repo/orchestrai.config.json",
    initialized: true,
  },
};

const userScope: UserScope = {
  kind: "user",
  root: "/Users/demo/.orchestrai",
  stateDir: "/Users/demo/.orchestrai",
};

describe("storageRoot", () => {
  it("resolves the empty namespace to the scope's own state directory", () => {
    expect(storageRoot(repoScope, "")).toBe("/repo/.orchestrai");
    expect(storageRoot(userScope, "")).toBe("/Users/demo/.orchestrai");
  });

  it("nests a declared namespace under the state directory", () => {
    expect(storageRoot(repoScope, "home")).toBe("/repo/.orchestrai/home");
    expect(storageRoot(userScope, "home")).toBe("/Users/demo/.orchestrai/home");
  });
});

describe("createCapabilityStorage", () => {
  it("reads and writes within its own root", () => {
    const fs = fakeFileSystem();
    const storage = createCapabilityStorage(repoScope, "home", fs);

    storage.writeFile("state.json", '{"token":"abc"}');

    expect(storage.root).toBe("/repo/.orchestrai/home");
    expect(storage.exists("state.json")).toBe(true);
    expect(storage.readFile("state.json")).toBe('{"token":"abc"}');
    expect(fs.files.get("/repo/.orchestrai/home/state.json")).toBe('{"token":"abc"}');
  });

  it("resolves nested paths under its root", () => {
    const fs = fakeFileSystem();
    const storage = createCapabilityStorage(repoScope, "home", fs);

    storage.mkdir("cache");
    storage.writeFile("cache/entry.json", "{}");

    expect(fs.files.has("/repo/.orchestrai/home/cache/entry.json")).toBe(true);
  });

  it("rejects a relative path that escapes its root", () => {
    const fs = fakeFileSystem();
    const storage = createCapabilityStorage(repoScope, "home", fs);

    expect(() => storage.readFile("../other/secret")).toThrow(StorageContainmentError);
    expect(() => storage.readFile("..")).toThrow(StorageContainmentError);
    expect(() => storage.writeFile("../../escape", "x")).toThrow(StorageContainmentError);
  });

  it("folds an absolute-looking path inside its root rather than treating it as an override", () => {
    // `path.join` never lets a later absolute-looking segment reset to the
    // filesystem root the way `path.resolve` would, so this lands inside
    // the capability's own directory rather than escaping to it — the same
    // safety property containment enforces for `../`, here for free.
    const fs = fakeFileSystem();
    const storage = createCapabilityStorage(repoScope, "home", fs);

    storage.writeFile("/etc/passwd", "not real");

    expect(fs.files.get("/repo/.orchestrai/home/etc/passwd")).toBe("not real");
    expect(fs.files.has("/etc/passwd")).toBe(false);
  });

  it("confines the root namespace to the state directory itself", () => {
    // Engineering's namespace is "", so its root equals stateDir directly.
    // Containment must still hold: nothing routed through this storage can
    // reach the repository root or a sibling of .orchestrai/.
    const fs = fakeFileSystem();
    const storage = createCapabilityStorage(repoScope, "", fs);

    expect(storage.root).toBe("/repo/.orchestrai");
    expect(() => storage.readFile("../orchestrai.config.json")).toThrow(
      StorageContainmentError,
    );
  });

  it("lets two capabilities persist independent state with no collision and no shared knowledge", () => {
    // The proof this milestone exists for: two unrelated namespaces, same
    // underlying filesystem host, same scope. Neither storage handle knows
    // the other exists, yet a same-named file in each never collides.
    const fs = fakeFileSystem();
    const home = createCapabilityStorage(repoScope, "home", fs);
    const camperCad = createCapabilityStorage(repoScope, "campercad", fs);

    home.writeFile("state.json", '{"owner":"home"}');
    camperCad.writeFile("state.json", '{"owner":"campercad"}');

    expect(home.readFile("state.json")).toBe('{"owner":"home"}');
    expect(camperCad.readFile("state.json")).toBe('{"owner":"campercad"}');
    expect(fs.files.get("/repo/.orchestrai/home/state.json")).toBe('{"owner":"home"}');
    expect(fs.files.get("/repo/.orchestrai/campercad/state.json")).toBe(
      '{"owner":"campercad"}',
    );

    // Neither can reach into the other's namespace, even by construction.
    expect(() => home.readFile("../campercad/state.json")).toThrow(
      StorageContainmentError,
    );
  });

  it("namespaces storage under user scope the same way as repository scope", () => {
    const fs = fakeFileSystem();
    const storage = createCapabilityStorage(userScope, "home", fs);

    storage.writeFile("token", "secret");

    expect(storage.root).toBe("/Users/demo/.orchestrai/home");
    expect(fs.files.get("/Users/demo/.orchestrai/home/token")).toBe("secret");
  });
});
