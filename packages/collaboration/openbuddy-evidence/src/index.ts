 import { stableDigest, type BuddyArtifact, type BuddyEvidence, type BuddyEvidenceBundle, type BuddyVerification } from "@openbuddy/collaboration-protocol"
 
 export interface VerificationInput {
 	taskId: string
 	providerId: string
 	verifierId?: string
 	artifacts: BuddyArtifact[]
 	evidence: BuddyEvidence[]
 	accepted: boolean
 	reason?: string
 	now: string
 }
 
 export function createEvidenceBundle(input: Omit<BuddyEvidenceBundle, "bundleDigest">): BuddyEvidenceBundle {
 	return {
 		...input,
 		bundleDigest: stableDigest({ taskId: input.taskId, providerId: input.providerId, artifacts: input.artifacts, evidence: input.evidence, verification: input.verification }),
 	}
 }
 
 export function verifyBundle(bundle: BuddyEvidenceBundle): boolean {
 	return bundle.bundleDigest === stableDigest({ taskId: bundle.taskId, providerId: bundle.providerId, artifacts: bundle.artifacts, evidence: bundle.evidence, verification: bundle.verification })
 }
 
 export function recordVerification(input: VerificationInput): BuddyVerification {
 	const independent = Boolean(input.verifierId && input.verifierId !== input.providerId)
 	if (!independent) {
 		return {
 			status: "unverified",
 			providerId: input.providerId,
 			reason: input.reason ?? "an independent verifier is required",
 			createdAt: input.now,
 		}
 	}
 	return {
 		status: input.accepted ? "verified" : "rejected",
 		providerId: input.providerId,
 		verifierId: input.verifierId,
 		reason: input.reason,
 		createdAt: input.now,
 	}
 }
 
 export function buildVerifiedBundle(input: VerificationInput): BuddyEvidenceBundle {
 	const verification = recordVerification(input)
 	return createEvidenceBundle({
 		taskId: input.taskId,
 		providerId: input.providerId,
 		artifacts: input.artifacts,
 		evidence: input.evidence,
 		verification,
 	})
 }
