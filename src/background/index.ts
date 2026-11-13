import type { CommandName, ContentMessage } from '../shared/messages';
import { getSettings, saveSettings } from '../shared/storage';

chrome.runtime.onInstalled.addListener(() => {
  void getSettings().then((settings) => saveSettings(settings));
});

chrome.commands.onCommand.addListener(async (command) => {
  const message: ContentMessage = { type: 'command', command: command as CommandName };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // No content script in this tab (chrome:// page, store page, etc.).
  }
});