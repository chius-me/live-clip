import { isValidRoomId } from "../shared/ids";
import { Pad } from "./Pad";

export function App() {
  const path = window.location.pathname;
  const match = path.match(/^\/p\/([^/]+)$/);
  const roomId = match?.[1];

  if (!roomId || !isValidRoomId(roomId)) {
    return (
      <div className="invalid">
        <div>
          <h1>LiveClip</h1>
          <p>链接无效。房间 ID 必须是 22 位随机标识。</p>
          <a href="/">创建新文档</a>
        </div>
      </div>
    );
  }

  return <Pad roomId={roomId} />;
}
