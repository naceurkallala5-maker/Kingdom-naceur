// Records real work activity for an employee, so the Live Office Board shows
// actual sessions. Writes directly to the company database.
//
// Usage:
//   npm run office -- start  <employeeId> [--task <taskId>] [--status working|researching|meeting] [--note "..."]
//   npm run office -- status <sessionId> <status> [--note "..."]
//   npm run office -- end    <sessionId> [--done] [--note "..."]
//   npm run office -- task   <employeeId> "<title>" "<objective>"
//   npm run office -- ask    <employeeId> <kind> "<title>" "<details>" [--task <taskId>]
//   npm run office -- board
//
// Notes, titles and details must be Arabic.

import { openDatabase } from '../src/db.js';
import { Office, OfficeError } from '../src/office.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const has = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};

const office = new Office(openDatabase(process.env.KINGDOM_DB || undefined));
const [command, ...rest] = args;

try {
  let result;
  switch (command) {
    case 'start': {
      const task = flag('task');
      const status = flag('status') ?? 'working';
      const note = flag('note') ?? null;
      result = office.startSession({ employeeId: Number(rest[0]), taskId: task ? Number(task) : null, status, note });
      break;
    }
    case 'status': {
      const note = flag('note') ?? null;
      result = office.changeSessionStatus(Number(rest[0]), { status: rest[1], note });
      break;
    }
    case 'end': {
      const done = has('done');
      const note = flag('note') ?? null;
      result = office.endSession(Number(rest[0]), { taskDone: done, note });
      break;
    }
    case 'task':
      result = office.createTask({ employeeId: Number(rest[0]), title: rest[1], objective: rest[2] });
      break;
    case 'ask': {
      const task = flag('task');
      result = office.requestApproval({
        employeeId: Number(rest[0]), kind: rest[1], title: rest[2], details: rest[3], taskId: task ? Number(task) : null,
      });
      break;
    }
    case 'board':
      result = office.board().employees.map((e) => ({ id: e.id, name: e.name, status: e.status, task: e.currentTask?.title ?? null }));
      break;
    default:
      console.error('Unknown command. See the usage notes at the top of scripts/office-cli.js.');
      process.exit(2);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  if (err instanceof OfficeError) {
    console.error(`Error: ${err.code}`);
    process.exit(1);
  }
  throw err;
}
