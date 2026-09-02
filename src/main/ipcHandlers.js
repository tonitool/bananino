import { ipcMain } from 'electron'
import { IPC } from './constants.js'

const asString = (value) => (typeof value === 'string' ? value : '')

/**
 * Everything crossing the bridge is treated as untrusted input: the renderer is sandboxed
 * and context-isolated, but a compromised page must not be able to hand the main process
 * a shape it does not expect.
 */
export const registerIpcHandlers = ({ interaction, perch, actions, mic }) => {
  const listeners = {
    [IPC.setInteractive]: (_e, value) => interaction.setInteractive(Boolean(value)),
    [IPC.dragStart]: () => interaction.startDrag(),
    [IPC.dragEnd]: () => interaction.stopDrag(),
    [IPC.openMenu]: () => actions.openMenu(),

    [IPC.closePanel]: () => perch.setPanelOpen(false),
    [IPC.togglePanel]: () => actions.togglePanel(),
    [IPC.setPanelHeight]: (_e, height) => perch.setPanelHeight(Number(height)),
    [IPC.requestSnapshot]: () => actions.pushSnapshot(),

    [IPC.saveNote]: (_e, text) => actions.saveNote(asString(text)),
    [IPC.noteMenu]: (_e, index) => actions.openNoteMenu(Number(index)),
    [IPC.deleteNote]: (_e, index) => actions.deleteNote(Number(index)),
    // Accepts a plain name or a name plus the MOCO task it books to.
    [IPC.startTimer]: (_e, payload) => {
      const task = typeof payload === 'string' ? payload : asString(payload?.task)
      const binding =
        Number.isFinite(payload?.binding?.projectId) && Number.isFinite(payload?.binding?.taskId)
          ? {
              projectId: payload.binding.projectId,
              taskId: payload.binding.taskId,
              label: asString(payload.binding.label) || task,
            }
          : null
      actions.startTimer(task, binding, asString(payload?.description))
    },
    [IPC.stopTimer]: () => actions.stopTimer(),
    [IPC.describeTimer]: (_e, text) => actions.describeTimer(asString(text)),
    [IPC.nudgeTimer]: (_e, minutes) => actions.nudgeTimer(Number(minutes)),
    [IPC.addManualTime]: (_e, payload) =>
      actions.addManualTime({
        task: asString(payload?.task),
        date: asString(payload?.date),
        duration: asString(payload?.duration),
        description: asString(payload?.description),
        binding:
          Number.isFinite(payload?.binding?.projectId) && Number.isFinite(payload?.binding?.taskId)
            ? {
                projectId: payload.binding.projectId,
                taskId: payload.binding.taskId,
                label: asString(payload.binding.label) || asString(payload?.task),
              }
            : null,
      }),

    [IPC.micChunk]: (_e, samples) => {
      if (samples instanceof Float32Array) mic.handleChunk(samples)
    },
    [IPC.micState]: (_e, state) =>
      mic.handleState({ event: asString(state?.event), message: asString(state?.message) }),

    [IPC.meetingStart]: (_e, payload) => actions.meetingStart({ title: asString(payload?.title) }),
    [IPC.meetingStop]: () => actions.meetingStop(),
    [IPC.meetingCancel]: () => actions.meetingCancel(),

    [IPC.copyClip]: (_e, id) => actions.copyClip(asString(id)),
    [IPC.deleteClip]: (_e, id) => actions.deleteClip(asString(id)),
    [IPC.pinClip]: (_e, id) => actions.pinClip(asString(id)),
    [IPC.clearClips]: () => actions.clearClips(),

    [IPC.revealData]: () => actions.revealData(),
    [IPC.setCostume]: (_e, name) => actions.setCostume(asString(name)),

    [IPC.mocoConnect]: (_e, payload) =>
      actions.mocoConnect({
        subdomain: asString(payload?.subdomain),
        apiKey: asString(payload?.apiKey),
      }),
    [IPC.mocoDisconnect]: () => actions.mocoDisconnect(),
    [IPC.mocoPush]: () => actions.mocoPush(),
    [IPC.mocoRefresh]: () => actions.mocoRefresh(),
    [IPC.mocoDiscard]: (_e, id) => actions.mocoDiscard(asString(id)),

    [IPC.calendarConnect]: (_e, payload) =>
      actions.calendarConnect({
        apiKey: asString(payload?.apiKey),
        authConfigId: asString(payload?.authConfigId),
      }),
    [IPC.calendarLink]: () => actions.calendarLink(),
    [IPC.calendarDisconnect]: () => actions.calendarDisconnect(),
    [IPC.calendarRefresh]: () => actions.calendarRefresh(),
    [IPC.calendarJoin]: (_e, payload) => actions.calendarJoin(asString(payload?.url)),
    [IPC.calendarCreate]: (_e, payload) =>
      actions.calendarCreate({
        title: asString(payload?.title),
        date: asString(payload?.date),
        startTime: asString(payload?.startTime),
        minutes: Number(payload?.minutes),
        online: payload?.online === true,
        // The renderer sends the invitees field as one free-text string; keep it so —
        // parsing happens next to validation, closer to the wire.
        attendees: Array.isArray(payload?.attendees)
          ? payload.attendees.map(asString).filter(Boolean).join(' ')
          : asString(payload?.attendees),
      }),

  }

  for (const [channel, listener] of Object.entries(listeners)) ipcMain.on(channel, listener)

  return () => {
    for (const channel of Object.keys(listeners)) ipcMain.removeAllListeners(channel)
  }
}
