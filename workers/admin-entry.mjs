import adminWorker from "./admin.mjs";
import { handleComponentMapperDataRequest } from "./component-mapper-data.mjs";
import { handleGeoMapsConfigRequest } from "./geo-maps-config.mjs";
import { handleGeoV2AdminRequest } from "./geo-v2-admin.mjs";
import { handleGeoPlotMappingAdmin } from "./geo-plot-mapping.mjs";
import { handleModelScaleReviewRequest } from "./model-scale-review.mjs";
import { handleProcessingRequest } from "./processing-jobs.mjs";
import { handleReviewedComponentBindingsRequest } from "./reviewed-component-bindings.mjs";
import { handleSourceClassificationRequest } from "./source-classification.mjs";
import { handleSourcePackReviewRequest } from "./source-pack-review.mjs";
import { handleSourceVerificationRequest } from "./source-verification.mjs";
import { handleSourceUploadRequest } from "./source-upload.mjs";

export { DwgProcessor } from "./dwg-processor-container.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const reviewResponse = await handleSourcePackReviewRequest(request, env, url);
    if (reviewResponse) return reviewResponse;

    const mapperResponse = await handleComponentMapperDataRequest(request, env, url);
    if (mapperResponse) return mapperResponse;

    const bindingResponse = await handleReviewedComponentBindingsRequest(
      request,
      env,
      url,
    );
    if (bindingResponse) return bindingResponse;

    const geoMapsResponse = await handleGeoMapsConfigRequest(request, env, url);
    if (geoMapsResponse) return geoMapsResponse;

    const plotMappingResponse = await handleGeoPlotMappingAdmin(request, env, url);
    if (plotMappingResponse) return plotMappingResponse;

    const geoV2Response = await handleGeoV2AdminRequest(request, env, url);
    if (geoV2Response) return geoV2Response;

    const scaleReviewResponse = await handleModelScaleReviewRequest(request, env, url);
    if (scaleReviewResponse) return scaleReviewResponse;

    const processingResponse = await handleProcessingRequest(request, env, url, ctx);
    if (processingResponse) return processingResponse;

    const classificationResponse = await handleSourceClassificationRequest(
      request,
      env,
      url,
    );
    if (classificationResponse) return classificationResponse;

    const verificationResponse = await handleSourceVerificationRequest(
      request,
      env,
      url,
    );
    if (verificationResponse) return verificationResponse;

    const sourceResponse = await handleSourceUploadRequest(request, env, url);
    if (sourceResponse) return sourceResponse;
    return adminWorker.fetch(request, env, ctx);
  },
};
