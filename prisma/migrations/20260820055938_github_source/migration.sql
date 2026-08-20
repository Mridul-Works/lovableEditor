-- AlterTable
ALTER TABLE "Page" ADD COLUMN "sourceBranch" TEXT;
ALTER TABLE "Page" ADD COLUMN "sourcePath" TEXT;
ALTER TABLE "Page" ADD COLUMN "sourceRepo" TEXT;

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);
