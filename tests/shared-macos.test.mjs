import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('shared profile keeps private caller context and explicit signing secrets',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/macos-tauri-python.yml',import.meta.url),'utf8');
  assert.match(workflow,/workflow_call:/);
  assert.match(workflow,/github.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/contents: read/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.equal((workflow.match(/required: true/g)||[]).length,7);
  assert.doesNotMatch(workflow,/environment:|REPLYBOT_DEPLOY_KEY|gh release create|pull_request/);
  assert.match(workflow,/notary-status\.json/);
  assert.doesNotMatch(workflow,/path: \.runtime\s*$/m);
});
