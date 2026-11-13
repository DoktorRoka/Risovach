export type CommandName = 'toggle-lock' | 'toggle-visibility';

export type ContentMessage =
  | { type: 'set-enabled'; enabled: boolean }
  | { type: 'set-image'; dataUrl: string }
  | { type: 'command'; command: CommandName }
  | { type: 'get-state' };

export interface ContentResponse {
  ok: boolean;
  enabled?: boolean;
  hasImage?: boolean;
  locked?: boolean;
  error?: string;
}