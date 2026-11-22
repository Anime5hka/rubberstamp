// A plain script (run with `node send.test.js`), because node:test turns unhandled rejections
// into test failures by itself.
// rubberstamp must not attach handlers to the promises your code returns: that would mark this
// rejection as handled, and the script would see a different program.
import { send } from './send.js';

let seen = null;
process.on('unhandledRejection', (reason) => { seen = reason; });
send('bye');
setTimeout(() => {
  if (!/send failed: bye/.test(String(seen))) {
    console.error(`expected an unhandled rejection, got ${seen}`);
    process.exitCode = 1;
  }
}, 20);
