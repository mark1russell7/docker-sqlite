# Release

`RELEASING.md` at the root of the repository tells how a version of `@mark1russell7/docker-sqlite` goes to npm. In short:

1. Change the version in `package.json` with the SemVer rules, for example to `0.1.1`.
2. Add the changes to `CHANGELOG.md`, below a heading with the version.
3. Merge the change to `main`.

The workflow `.github/workflows/release.yml` starts the CI gates, builds and packs the package, and publishes it with npm trusted publishing (OIDC) and a provenance statement. It needs no npm token, no tag and no approval. After the publish, it makes the git tag `v<version>` and a GitHub release with the section of the version in `CHANGELOG.md`.

## Check a version before the publish

```sh
pnpm build
npm pack
npx publint ./mark1russell7-docker-sqlite-<version>.tgz --strict
npx @arethetypeswrong/cli ./mark1russell7-docker-sqlite-<version>.tgz --profile esm-only
```
