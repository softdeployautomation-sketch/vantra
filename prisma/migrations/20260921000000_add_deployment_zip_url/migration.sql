-- AddDeploymentZipUrl
-- STAGE 2: masked zip install link stored on the Deployment row (installMethod = "zip").
ALTER TABLE "Deployment" ADD COLUMN "zipUrl" TEXT;