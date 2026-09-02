import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  detectVideoContainer,
  isVideoContentCompatible,
} from "../server/utils/videoUploadPolicy.ts";

const mp4 = Buffer.alloc(16);
mp4.write("ftyp", 4, "ascii");
assert.equal(detectVideoContainer(mp4), "iso-bmff");
assert.equal(isVideoContentCompatible(mp4, "video/mp4"), true);
assert.equal(isVideoContentCompatible(mp4, "video/webm"), false);

const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
assert.equal(detectVideoContainer(webm), "ebml");
assert.equal(isVideoContentCompatible(webm, "video/webm"), true);

assert.equal(
  isVideoContentCompatible(Buffer.from("<script>alert(1)</script>"), "video/mp4"),
  false,
);

const routes = readFileSync("server/storiesRoutes.ts", "utf8");
const imageUpload = readFileSync("server/imageUpload.ts", "utf8");
const authIndex = routes.indexOf("isAuthenticated,");
const burstIndex = routes.indexOf("storyUploadBurstLimiter,", authIndex);
const dailyIndex = routes.indexOf("storyUploadDailyIngressLimiter,", burstIndex);
const multerIndex = routes.indexOf("parseStoryVideoUpload,", dailyIndex);
assert(
  authIndex >= 0 && burstIndex > authIndex && dailyIndex > burstIndex && multerIndex > dailyIndex,
  "Authenticated ingress limits must run before multer allocates the upload in memory.",
);
assert(
  routes.includes("isVideoContentCompatible(req.file.buffer, req.file.mimetype)"),
  "Story uploads must inspect file content after buffering.",
);
assert(
  routes.includes("cloudinaryResult.durationSeconds > 30") &&
    routes.includes("duration: verifiedDuration"),
  "Cloudinary's decoded duration must be enforced and stored instead of trusting the browser.",
);
assert(
  imageUpload.includes('resource_type: "video"'),
  "Story media must be uploaded as a Cloudinary video resource.",
);

console.log("story upload ingress behavior passed");
