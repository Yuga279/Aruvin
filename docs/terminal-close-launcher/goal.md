# Terminal-close launcher

Approved in this session: implement a Windows launcher that permits closing the backend terminal normally without requiring Ctrl+C. The backend and its shutdown coordinator must survive that console closing, request the existing backend IPC `shutdown`, and allow the established drain/close path to finish.

## Scope and acceptance
- Integrate with `run.bat`; keep the visible backend terminal and existing local ports and frontend launch behavior.
- Reuse Node and existing IPC shutdown; no dependency, HTTP administration endpoint, database mutation, sentinel deletion, or automatic takeover.
- Console disappearance and Ctrl+C initiate one graceful stop. Shutdown is bounded at 45 seconds; unsafe termination remains an unsafe exit requiring operator recovery.
- Handle backend startup failure, console attachment failure, early console closure, and process errors without leaving an unnoticed executor running.
- Use deterministic disposable-process tests with no configured database or paid provider calls. Verify Windows process isolation and a real disposable console-close path where the environment permits; report any unverified GUI behavior explicitly.
- Update local usage documentation. Existing blocked database is not repaired by this change.

## Design boundary
A hidden, console-independent coordinator owns a hidden backend with an IPC channel. A visible terminal is only a display/lifetime client; its disappearance asks the coordinator to shut down the backend. Implementation planning must verify Windows detachment semantics rather than assume `windowsHide` alone isolates a child from console close.

Direct backend launches, forced coordinator termination, machine shutdown, and crashes are outside the graceful-close guarantee. Existing executor fencing remains unchanged.
