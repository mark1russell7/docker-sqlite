# Release

This document tells how to publish a new version of `@mark1russell7/docker-sqlite` to npm.

## Set up the trusted publisher (one time)

The workflow `.github/workflows/release.yml` publishes the package. It uses npm trusted publishing, so the repository needs no npm token.

1. In the GitHub settings of the repository, make an environment with the name `npm`. Add the owner as a required reviewer, so each publish waits for an approval.
2. The package must exist on npm before it can have a trusted publisher. Publish the first version from a computer (see "The first version").
3. Connect the package to the workflow. The command asks for a 2FA code:

   ```sh
   npm trust github @mark1russell7/docker-sqlite --file release.yml --repo mark1russell7/docker-sqlite --env npm --allow-publish
   ```

   Trusted publishing needs npm 11.5.1 or later. `--allow-publish` is necessary, because a new trusted publisher allows only staged publishing by default.
4. After the first publish from the workflow, set "Require two-factor authentication and disallow tokens" in the settings of the package on npmjs.com.

## Publish a version

1. Change the version in `package.json`, for example to `0.1.1`.
2. Add the changes to `CHANGELOG.md`, below a heading with the version.
3. Commit the two changes and push them to `main`.
4. Make a tag with the version and push it:

   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```

The workflow examines the tag. The tag must be `v` and the version of `package.json`. Then the workflow builds the package, checks the types, starts the tests and lists the files of the tarball. Then it publishes the package with a provenance statement. npm shows the statement on the page of the package.

## The first version

The first version, 0.1.0, comes from a computer, because a trusted publisher needs a package that exists. With 2FA for writes on the npm account, use one of these:

- `npm publish --access public` with a 2FA code (`--otp`).
- `npm stage publish`, then approve the staged version on npmjs.com or with `npm stage approve <stage-id>`.

## Check a version before the publish

```sh
pnpm build
npm pack
npx publint ./mark1russell7-docker-sqlite-<version>.tgz --strict
npx @arethetypeswrong/cli ./mark1russell7-docker-sqlite-<version>.tgz --profile esm-only
```
