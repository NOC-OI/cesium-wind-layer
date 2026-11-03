# Developer Guide - cesium-wind-layer

This guide explains how to set up and work on the `cesium-wind-layer`
monorepo. It covers the `cube-cesium-wind-layer` package and the React/Vite
demo application that exercises the package with live Zarr current data.

## 1. Repository structure

```text
cesium-wind-layer/
├── packages/
│   └── cesium-wind-layer/  # Publishable Cesium wind-layer library
├── example/                # React/Vite demo application
├── pictures/               # README screenshots and animations
├── package.json            # Workspace scripts
├── pnpm-workspace.yaml     # Workspace package definitions
└── turbo.json              # Build, development, and lint task configuration
```

The repository is a pnpm workspace managed by Turbo. The demo depends on the
library through the workspace package reference, so local library changes can
be tested without publishing a package.

## 2. Install dependencies

Use Node.js 24 or a compatible current Node.js release and pnpm 9.10.0, which
is the version declared by the repository:

```bash
git clone https://github.com/NOC-OI/cesium-wind-layer.git
cd cesium-wind-layer
corepack enable
corepack prepare pnpm@9.10.0 --activate
pnpm install
```

For CI-like installation, use the lockfile without updating it:

```bash
pnpm install --frozen-lockfile
```

## 3. Run the demo

Start the library and demo development tasks together from the repository root:

```bash
pnpm dev
```

The demo is served by Vite at [http://localhost:5173](http://localhost:5173).
Vite is configured to open the browser automatically.

To run either task separately:

```bash
# Library watch build
pnpm --filter cube-cesium-wind-layer dev

# Demo development server
pnpm --filter example dev
```

The demo loads the global currents dataset from the URLs in
[`example/src/data/zarrCurrents.ts`](./example/src/data/zarrCurrents.ts). It
loads both a surface field and the first fifteen depth levels of a velocity
cube. The loader converts the source arrays to the elevation-major,
row-major format expected by `WindLayer`, detects latitude and elevation
orientation, and rotates datasets whose longitudes use a `0..360` range.

## 4. Configure demo terrain

The demo uses a default terrain URL. To use another terrain service, create
`example/.env.local`:

```env
VITE_TERRAIN_URL=https://your-terrain-server/terrain-tileset/
```

Restart Vite after changing environment variables. `VITE_BASE_PATH` controls
the generated asset base path and is normally only needed for deployment:

```bash
VITE_BASE_PATH=./ pnpm --filter example build
```

Do not commit credentials or private service URLs to the repository.

## 5. Develop the library

The library source is under
[`packages/cesium-wind-layer/src/`](./packages/cesium-wind-layer/src/).
The main areas are:

- `windParticleSystem.ts`: particle-system lifecycle and data updates
- `windParticlesComputing.ts`: GPU computation setup
- `windParticlesRendering.ts`: particle rendering setup
- `shaders/`: GLSL calculation, position, and drawing shaders
- `types.ts`: public data and option types
- `index.ts`: public package exports

Run a one-time production build:

```bash
pnpm --filter cube-cesium-wind-layer build
```

Run the package build in watch mode while editing:

```bash
pnpm --filter cube-cesium-wind-layer dev
```

In another terminal, run the demo:

```bash
pnpm --filter example dev
```

The demo imports `cube-cesium-wind-layer` through the workspace dependency, so
the watch build makes library changes available to the demo.

## 6. Build, lint, and validate

Run the repository-wide tasks through Turbo:

```bash
pnpm build
pnpm lint
pnpm test
```

The package currently provides build and lint tasks. The example provides its
Vite build. Before opening a pull request, at minimum run:

```bash
pnpm --filter cube-cesium-wind-layer build
pnpm --filter cube-cesium-wind-layer lint
pnpm --filter example build
```

The production demo output is written to `example/dist/` and is ignored by
Git.

## 7. Deploy the demo

The workflow in
[`.github/workflows/deploy-demo.yml`](./.github/workflows/deploy-demo.yml)
builds the library and demo, then publishes `example/dist/` to GitHub Pages
when changes are pushed to `main` or the workflow is started manually.

To reproduce the workflow's build locally:

```bash
pnpm install --frozen-lockfile
pnpm --filter cube-cesium-wind-layer build
VITE_BASE_PATH=./ pnpm --filter example build
```

## 8. Release the package

Releases use [Changesets](https://github.com/changesets/changesets) to record
package changes and Git tags to trigger publishing. Only the
`cube-cesium-wind-layer` package is published; the root workspace and demo
remain private.

### 8.1. Add a changeset

When a pull request changes the public package, create a changeset from the
repository root:

```bash
pnpm changeset
```

Select `cube-cesium-wind-layer`, choose the appropriate version bump, and
describe the user-facing change. Commit the generated Markdown file under
[`.changeset/`](./.changeset/) with the pull request.

Use a patch release for bug fixes, a minor release for backwards-compatible
features, and a major release for breaking API changes. Documentation-only
or demo-only changes do not need a package changeset.

### 8.2. Apply the release version

After the changeset pull requests are merged into `main`, update the local
branch and apply the pending changesets:

```bash
git checkout main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm version
```

`pnpm version` runs `changeset version`, updates the package version and
changelog, and removes the consumed changeset files. Review the result:

```bash
git diff -- packages/cesium-wind-layer/package.json \
  packages/cesium-wind-layer/CHANGELOG.md pnpm-lock.yaml
```

If there are no pending changesets, do not create a release. Add a changeset
first and repeat the process.

### 8.3. Validate and tag the release

Build the package and inspect the version before committing:

```bash
pnpm --filter cube-cesium-wind-layer build
pnpm --filter cube-cesium-wind-layer pack --dry-run
node -p "require('./packages/cesium-wind-layer/package.json').version"
```

Confirm that the package contents include the expected `dist/` files and no
secrets, then commit the version and changelog:

```bash
VERSION=$(node -p "require('./packages/cesium-wind-layer/package.json').version")
git add .changeset packages/cesium-wind-layer/package.json \
  packages/cesium-wind-layer/CHANGELOG.md pnpm-lock.yaml
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin main
git push origin "v$VERSION"
```

Do not push a tag until the tag version exactly matches
`packages/cesium-wind-layer/package.json`. The
[`.github/workflows/tag-package.yml`](./.github/workflows/tag-package.yml)
workflow checks this before building and publishing.

### 8.4. What the release workflow does

For a `v*` tag, GitHub Actions:

1. Installs the locked pnpm dependencies.
2. Verifies that the tag matches the package version.
3. Builds the package and creates an installable `.tgz` tarball.
4. Publishes the package to npm with public access and provenance.
5. Uploads the tarball and creates a GitHub Release with generated notes.

The workflow uses npm trusted publishing through GitHub OIDC. Do not add an
`NPM_TOKEN` or other registry credential to the repository.

## 9. Contribution workflow

Use a focused branch for each change, for example:

```text
feature/cube-particle-density
fix/terrain-occlusion
docs/update-developer-guide
```

When submitting a pull request:

- Explain the behavior or API change and how it was tested.
- Update the package README when public API behavior changes.
- Keep demo-only changes separate from library changes where practical.
- Include build and lint results for the affected workspace packages.
- Do not commit generated `dist/` output, dependency directories, or secrets.
