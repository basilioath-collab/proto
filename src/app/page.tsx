import { legacyTemplate } from "@/legacy/template";

const basePath = "/proto";

export default function Home() {
  return (
    <>
      <div id="orizon-root" dangerouslySetInnerHTML={{ __html: legacyTemplate }} />
      <script src={`${basePath}/app.js`} defer />
    </>
  );
}
