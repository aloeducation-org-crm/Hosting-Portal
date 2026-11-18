-- NULL preserves the sign-in policy for every pre-existing account.
ALTER TABLE "users" ADD COLUMN "signupApprovalStatus" TEXT;
