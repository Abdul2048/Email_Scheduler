-- DropIndex
DROP INDEX "Email_userId_status_sentAt_idx";

-- CreateIndex
CREATE INDEX "Email_userId_status_updatedAt_idx" ON "Email"("userId", "status", "updatedAt");
