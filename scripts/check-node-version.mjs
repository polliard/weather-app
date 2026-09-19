// Runs before `npm start` and `npm test` (see the `prestart`/`pretest`
// scripts in package.json). The application runs its .ts sources directly
// through Node's built-in type stripping, which needs Node.js 24 or newer; on
// an older Node the real entry points fail with an unhelpful "unknown file
// extension" or syntax error, so this says plainly what is missing instead.
//
// Deliberately plain JavaScript with no dependencies, so it parses on any
// Node.js that could be installed by mistake.
const REQUIRED_MAJOR = 24;

const major = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(major) || major < REQUIRED_MAJOR) {
  process.stderr.write(
    `weather-app needs Node.js ${REQUIRED_MAJOR} or newer, but this is Node.js ${process.version}.\n` +
      `Install a supported version (the repository's .nvmrc / .node-version pin ${REQUIRED_MAJOR}) and try again.\n`,
  );
  process.exit(1);
}
