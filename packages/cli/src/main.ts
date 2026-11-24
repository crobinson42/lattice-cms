import { collectionCommand, collectionUsage } from './collection.js';
import { Exit } from './exit.js';

export const help = `Usage: lattice <command> [options]

Commands:
  collection <slug>   Add a collection, its test, and its registrations.

Run lattice <command> --help for a command's options.
`;

const commands: Record<
  string,
  {
    readonly usage: string;
    readonly run: (args: readonly string[], cwd: string) => Promise<void>;
  }
> = {
  collection: { usage: collectionUsage, run: collectionCommand },
};

/** The first sentence of parseArgs' message, which goes on to explain `--`. */
const firstSentence = (message: string) => message.split(/\.\s/)[0] ?? message;

/**
 * Runs the command `args` names, in `cwd`, and returns the exit code: 0
 * done, 1 refused or failed, 2 a usage error.
 */
export async function main(
  args: readonly string[],
  cwd: string,
): Promise<number> {
  const [name, ...rest] = args;
  if (name === undefined || name === '--help' || name === '-h') {
    process.stdout.write(help);
    return name === undefined ? 2 : 0;
  }
  const command = commands[name];
  if (command === undefined) {
    process.stderr.write(`lattice: unknown command "${name}"\n\n${help}`);
    return 2;
  }
  try {
    await command.run(rest, cwd);
    return 0;
  } catch (error) {
    if (error instanceof Exit) {
      process.stderr.write(`lattice: ${error.message}\n`);
      if (error.code === 2) process.stderr.write(`${command.usage}\n`);
      if (error.details !== '') process.stdout.write(`${error.details}\n`);
      return error.code;
    }
    // parseArgs throws a TypeError for an unknown flag or a missing value.
    if (error instanceof TypeError && 'code' in error) {
      process.stderr.write(
        `lattice: ${firstSentence(error.message)}\n${command.usage}\n`,
      );
      return 2;
    }
    process.stderr.write(
      `lattice: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
