// Phase 5 schema modularization: domain barrel over legacy exports
export {
  workerProfiles,
  jobPosts,
  jobApplications,
  privateChefLeads,
  workerProfilesRelations,
  jobPostsRelations,
  jobApplicationsRelations,
  privateChefLeadsRelations,
  insertWorkerProfileSchema,
  insertJobPostSchema,
  insertJobApplicationSchema,
  insertPrivateChefLeadSchema,
} from "./legacy";

export type {
  WorkerProfile,
  InsertWorkerProfile,
  JobPost,
  InsertJobPost,
  JobApplication,
  InsertJobApplication,
  PrivateChefLead,
  InsertPrivateChefLead,
} from "./legacy";
