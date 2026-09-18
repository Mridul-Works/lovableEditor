-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "sourceRef" TEXT;

-- CreateIndex
CREATE INDEX "MediaAsset_sourceRef_idx" ON "MediaAsset"("sourceRef");
