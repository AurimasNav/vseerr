// VSeerr's image starts the app without npm (see the Dockerfile), so its CMD
// repeats Seerr's "start" script. This fails when the two differ, for example
// after a Seerr release changes the script, so the Dockerfile is updated too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const root = path.join(__dirname, '..');

const finalStage = (): string => {
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const stages = dockerfile.split(/^FROM /m);
  return stages[stages.length - 1];
};

describe('VSeerr image', () => {
  it('starts the app the way Seerr\'s "start" script does', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    const start = pkg.scripts.start;
    const entry = /^NODE_ENV=production node (\S+)$/.exec(start)?.[1];
    assert.ok(
      entry,
      `Seerr's "start" script is now "${start}". Update CMD in the Dockerfile to run the same command without npm, then update this test.`
    );

    const stage = finalStage();
    assert.match(stage, /^ENV NODE_ENV=production$/m);
    const cmd = /^CMD (\[.*\])$/m.exec(stage)?.[1];
    assert.ok(cmd, 'The Dockerfile has no CMD in its final stage.');
    assert.deepEqual(
      JSON.parse(cmd),
      ['node', entry],
      `The Dockerfile's CMD must match Seerr's "start" script: ${start}`
    );
  });

  it('removes npm and keeps tini in front of node', () => {
    const stage = finalStage();
    assert.match(stage, /rm -rf \/usr\/local\/lib\/node_modules\/npm /);
    assert.match(stage, /^ENTRYPOINT \[ "\/sbin\/tini", "--", /m);
  });
});
