import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  detectVideoContainer,
  isVideoContentCompatible,
} from "../server/utils/videoUploadPolicy.ts";
import { cloudinaryPublicIdFromDeliveryUrl } from "../server/imageUpload.ts";

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

assert.equal(
  cloudinaryPublicIdFromDeliveryUrl(
    "https://res.cloudinary.com/mealscout/video/upload/v1234567890/mealscout/stories/story-1.mp4",
  ),
  "mealscout/stories/story-1",
);
assert.equal(
  cloudinaryPublicIdFromDeliveryUrl("https://example.com/video/upload/v1/story.mp4"),
  null,
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
assert(
  imageUpload.includes('reject(new Error("Video duration unavailable"))') &&
    imageUpload.includes('resourceType: "video"'),
  "Uploads without an authoritative decoded duration must be deleted before rejection.",
);
assert(
  routes.includes("cloudinaryPublicIdFromDeliveryUrl(story[0].videoUrl)") &&
    routes.includes("deleteFromCloudinary(publicId, { resourceType: 'video' })"),
  "Story deletion must destroy the video public ID instead of passing a delivery URL as an image ID.",
);
assert(
  routes.includes("let uploadedVideoPublicId: string | null = null") &&
    routes.includes("if (uploadedVideoPublicId)") &&
    routes.includes("Story insert returned no record"),
  "An uploaded video must be deleted if persistence fails before the story becomes authoritative.",
);

console.log("story upload ingress behavior passed");
