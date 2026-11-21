import { writeFile } from 'node:fs/promises';
import type { CommandHandlers } from '@openbuddy/protocol/contract';
import type { NativeContext } from './context.js';

/** Native `export` commands (20261115-md §5.3). Writes to paths granted by a save dialog: plain text export and Pi's HTML export. */
export function exportCommands(ctx: NativeContext): CommandHandlers {
  const { exportGrants, options } = ctx;
  const commands: CommandHandlers = {
    export_text_file: async payload => {
      if (typeof payload.path !== 'string' || typeof payload.content !== 'string' || !exportGrants.delete(payload.path)) throw new Error('export_path_not_authorized');
      await writeFile(payload.path, payload.content, 'utf8');
      return payload.path;
    },
    // Real HTML export (Pi's exporter) to a path the user chose in the save dialog.
    agent_export_html: async payload => {
      if (typeof payload.outputPath !== 'string' || !exportGrants.delete(payload.outputPath)) throw new Error('export_path_not_authorized');
      if (!options.exportHtml) throw new Error('not_implemented: agent_export_html');
      return options.exportHtml(String(payload.sessionId), payload.outputPath);
    },
  };
  return commands;
}
