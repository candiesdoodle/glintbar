/**
 * Work that keeps running whether or not these tiles are on the dock: timer and focus rounds
 * finishing, todo reminders and Alt+T, calendar feeds (renewals and payouts feed the clocks
 * too). Widgets are code-split and load only when shown, so this file is loaded at start-up
 * instead (every `src/widgets/<domain>/background.ts`, see src/core/background.ts).
 */
import { startCalendarSync } from "./calendar/store";
import { startPomodoroScheduler } from "./pomodoro/store";
import { startTimerScheduler } from "./timer/store";
import { startTodoHotkey } from "./todos/hotkey";
import { startTodoReminders } from "./todos/store";

startTimerScheduler();
startPomodoroScheduler();
startTodoReminders();
startTodoHotkey();
startCalendarSync();
