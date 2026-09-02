const { contextBridge, ipcRenderer } = require('electron')

// Mirrors src/main/constants.js. Kept literal because preload cannot import ESM.
const IPC = {
  micChunk: 'meeting:mic-chunk',
  micState: 'meeting:mic-state',
  meetingStart: 'meeting:start',
  meetingStop: 'meeting:stop',
  meetingCancel: 'meeting:cancel',

  setInteractive: 'pet:set-interactive',
  dragStart: 'pet:drag-start',
  dragEnd: 'pet:drag-end',
  openMenu: 'pet:open-menu',
  cursorMoved: 'pet:cursor-moved',
  command: 'pet:command',

  panelState: 'panel:state',
  closePanel: 'panel:close',
  togglePanel: 'panel:toggle',
  setPanelHeight: 'panel:height',
  requestSnapshot: 'data:request',
  snapshot: 'data:snapshot',

  saveNote: 'note:save',
  noteMenu: 'note:menu',
  deleteNote: 'note:delete',
  startTimer: 'timer:start',
  stopTimer: 'timer:stop',
  describeTimer: 'timer:describe',
  nudgeTimer: 'timer:nudge',
  addManualTime: 'timer:add-manual',

  copyClip: 'clip:copy',
  deleteClip: 'clip:delete',
  pinClip: 'clip:pin',
  clearClips: 'clip:clear',

  revealData: 'data:reveal',
  setCostume: 'costume:set',
  mocoConnect: 'moco:connect',
  mocoDisconnect: 'moco:disconnect',
  mocoPush: 'moco:push',
  mocoRefresh: 'moco:refresh',
  mocoDiscard: 'moco:discard',
  mocoCatalogue: 'moco:catalogue',

  calendarConnect: 'calendar:connect',
  calendarDisconnect: 'calendar:disconnect',
  calendarJoin: 'calendar:join',
  calendarRefresh: 'calendar:refresh',
}

/** Subscribes and hands back an unsubscribe function so callers cannot leak listeners. */
const subscribe = (channel, handler) => {
  const listener = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const send = (channel) => (payload) => ipcRenderer.send(channel, payload)

contextBridge.exposeInMainWorld('pet', {
  setInteractive: (value) => ipcRenderer.send(IPC.setInteractive, Boolean(value)),
  startDrag: () => ipcRenderer.send(IPC.dragStart),
  endDrag: () => ipcRenderer.send(IPC.dragEnd),
  openMenu: () => ipcRenderer.send(IPC.openMenu),

  closePanel: () => ipcRenderer.send(IPC.closePanel),
  togglePanel: () => ipcRenderer.send(IPC.togglePanel),
  setPanelHeight: send(IPC.setPanelHeight),
  requestSnapshot: () => ipcRenderer.send(IPC.requestSnapshot),

  sendMicChunk: send(IPC.micChunk),
  sendMicState: send(IPC.micState),

  startMeeting: send(IPC.meetingStart),
  stopMeeting: () => ipcRenderer.send(IPC.meetingStop),
  cancelMeeting: () => ipcRenderer.send(IPC.meetingCancel),

  saveNote: send(IPC.saveNote),
  noteMenu: send(IPC.noteMenu),
  deleteNote: send(IPC.deleteNote),
  startTimer: send(IPC.startTimer),
  stopTimer: () => ipcRenderer.send(IPC.stopTimer),
  describeTimer: send(IPC.describeTimer),
  nudgeTimer: send(IPC.nudgeTimer),
  addManualTime: send(IPC.addManualTime),

  copyClip: send(IPC.copyClip),
  deleteClip: send(IPC.deleteClip),
  pinClip: send(IPC.pinClip),
  clearClips: () => ipcRenderer.send(IPC.clearClips),

  revealData: () => ipcRenderer.send(IPC.revealData),
  setCostume: send(IPC.setCostume),

  mocoConnect: (payload) => ipcRenderer.send(IPC.mocoConnect, payload),
  mocoDisconnect: () => ipcRenderer.send(IPC.mocoDisconnect),
  mocoPush: () => ipcRenderer.send(IPC.mocoPush),
  mocoRefresh: () => ipcRenderer.send(IPC.mocoRefresh),
  mocoDiscard: send(IPC.mocoDiscard),
  onMocoCatalogue: (handler) => subscribe(IPC.mocoCatalogue, handler),

  calendarConnect: (payload) => ipcRenderer.send(IPC.calendarConnect, payload),
  calendarDisconnect: () => ipcRenderer.send(IPC.calendarDisconnect),
  calendarJoin: send(IPC.calendarJoin),
  calendarRefresh: () => ipcRenderer.send(IPC.calendarRefresh),

  onCursorMoved: (handler) => subscribe(IPC.cursorMoved, handler),
  onCommand: (handler) => subscribe(IPC.command, handler),
  onSnapshot: (handler) => subscribe(IPC.snapshot, handler),
  onPanelState: (handler) => subscribe(IPC.panelState, handler),
})
