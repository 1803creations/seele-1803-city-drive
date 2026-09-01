import * as THREE from "three";
import { ROOT_URL } from "./config.js";

export const $ = (selector) => document.querySelector(selector);

const REMOTE_ASSET_URLS = {
  "Textures/CCDS_Neon.tga": "https://static.seeles.ai/data/upload/085034bd-32cd-42c4-9f71-714062fdbd3b_CCDS_Neon.tga",
  "Textures/UI/CCDS_Icon_Money.png": "https://static.seeles.ai/data/upload/f2106d68-c14d-400f-9a96-0c9d7762c0f0_CCDS_Icon_Money.png",
  "Textures/UI/CCDS_Icon_Time.png": "https://static.seeles.ai/data/upload/f633d5f6-c45a-49a1-9ec3-e46f1b919e62_CCDS_Icon_Time.png",
  "Textures/UI/CCDS_Map_City1.PNG": "https://static.seeles.ai/data/upload/11385710-8c0b-4ec7-9b55-0df9e39ca678_CCDS_Map_City1.PNG",
  "Textures/UI/CCDS_Map_City2.png": "https://static.seeles.ai/data/upload/6227418a-6cae-4b8a-8384-84ae1b1882b5_CCDS_Map_City2.png",
  "Textures/UI/CCDS_Marker.png": "https://static.seeles.ai/data/upload/5a57fcf3-a02d-4d25-b3c7-7d80c7ca30c8_CCDS_Marker.png",
  "Textures/UI/CCDS_UI_Button.png": "https://static.seeles.ai/data/upload/54ace839-abbf-4842-94f1-620e75cf1d96_CCDS_UI_Button.png",
  "Textures/UI/CCDS_UI_ButtonFade.png": "https://static.seeles.ai/data/upload/cd6e65d6-7c23-452a-bf37-64649ae834cc_CCDS_UI_ButtonFade.png",
  "Textures/UI/CCDS_UI_Gradient.png": "https://static.seeles.ai/data/upload/90724285-655e-47aa-8125-60f3621d8a63_CCDS_UI_Gradient.png",
  "Textures/UI/CCDS_UI_ItemBackground.png": "https://static.seeles.ai/data/upload/96f8d8ad-208b-465a-987c-3e4a2d5355c7_CCDS_UI_ItemBackground.png",
  "Textures/UI/CCDS_UI_LabelBackground.png": "https://static.seeles.ai/data/upload/064eee8a-0e57-4cee-b9cb-cde73233d106_CCDS_UI_LabelBackground.png",
  "Textures/UI/CCDS_UI_Percentage.png": "https://static.seeles.ai/data/upload/6435667f-e281-4ea5-8ffd-014c7c497171_CCDS_UI_Percentage.png",
  "Textures/UI/CCDS_UI_Scene_Day.png": "https://static.seeles.ai/data/upload/03093935-d2c6-465b-be37-e2b6c55109c4_CCDS_UI_Scene_Day.png",
  "Textures/UI/CCDS_UI_Scene_Midnight.png": "https://static.seeles.ai/data/upload/17041c39-0244-4863-a62b-f2b3160ec7b5_CCDS_UI_Scene_Midnight.png",
  "Textures/UI/CCDS_UI_VerticalSliderCutted.png": "https://static.seeles.ai/data/upload/bb546bc0-5746-4948-bd94-3e687b4ed881_CCDS_UI_VerticalSliderCutted.png",
  "Textures/UI/CCDS_UI_Vignette.png": "https://static.seeles.ai/data/upload/b814efab-1eb5-4e53-9a8b-87442e8746ac_CCDS_UI_Vignette.png",
  "Textures/UI/RCCP_Sprite.png": "https://static.seeles.ai/data/upload/5c5f1d47-1a7d-413e-80e4-3986bb0c0893_RCCP_Sprite.png",
  "Textures/UI/Speedometer.tga": "https://static.seeles.ai/data/upload/0cf0dfb6-6613-4158-9251-2755acc74d63_Speedometer.tga",
  "Realistic Car Controller Pro/Textures/Particles/SmokeSprite.png": "https://static.seeles.ai/data/upload/bcc2bc49-057b-4e5c-861b-c9b8846f148e_SmokeSprite.png",
  "Realistic Car Controller Pro/Textures/Particles/Spark1.png": "https://static.seeles.ai/data/upload/cdc2fc7d-88d6-44f8-8be9-564b3e540713_Spark1.png",
  "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_Normal.png": "https://static.seeles.ai/data/upload/b468772b-9b5a-4e73-81bd-a5e864d52a6b_City_Highway_Road_Normal.png",
  "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_S.png": "https://static.seeles.ai/data/upload/a7abb670-b5ab-4b9b-a3b7-8edf312f5070_City_Highway_Road_S.png",
  "Realistic Car Controller Pro/Textures/Roads/City_Sidewalk.png": "https://static.seeles.ai/data/upload/8b44d00a-c94f-41ac-ad70-0c6f748ccbbc_City_Sidewalk.png",
  "Realistic Car Controller Pro/Textures/Roads/City_Sidewalk_Normal.png": "https://static.seeles.ai/data/upload/cf2ad718-53b5-45ce-ab1f-7ace2658cc46_City_Sidewalk_Normal.png",
  "Realistic Traffic Controller/Models/City/Tex/Asphalt.png": "https://static.seeles.ai/data/upload/59e935e0-7dd0-4db0-a299-af6660ba3131_Asphalt.png",
  "Realistic Traffic Controller/Models/City/Tex/N/Asphalt_N.png": "https://static.seeles.ai/data/upload/e0ea205c-189e-4372-9c12-6ef9dbbd9f9c_Asphalt_N.png",
  "Realistic Traffic Controller/Models/City/Tex/Concrete_Form_4x8.bmp": "https://static.seeles.ai/data/upload/fa3ae859-3e7e-4634-bafd-2df407e461ba_Concrete_Form_4x8.bmp",
  "Realistic Traffic Controller/Models/City/Tex/N/Concrete_Form_N.bmp": "https://static.seeles.ai/data/upload/0df19544-00e6-4ae7-8d4b-3bf13ec897b3_Concrete_Form_N.bmp",
  "Realistic Traffic Controller/Models/City/Tex/Concrete_Squares.bmp": "https://static.seeles.ai/data/upload/d9db1a85-2de6-4531-9306-a8de39df2d0a_Concrete_Squares.bmp",
  "Realistic Car Controller Pro/Textures/UI/Background.tif": "https://static.seeles.ai/data/upload/ec147c17-f35d-4ec1-a0eb-2af7a29f85d6_Background.tif",
  "Realistic Car Controller Pro/Textures/UI/ButtonSprite.png": "https://static.seeles.ai/data/upload/d0f0356d-8451-4e4d-af23-22f53efca28b_ButtonSprite.png",
  "Realistic Car Controller Pro/Textures/UI/RCCP_Sprite.png": "https://static.seeles.ai/data/upload/5c5f1d47-1a7d-413e-80e4-3986bb0c0893_RCCP_Sprite.png",
  "Realistic Car Controller Pro/Textures/UI/Speedometer.tga": "https://static.seeles.ai/data/upload/0cf0dfb6-6613-4158-9251-2755acc74d63_Speedometer.tga",
  "Realistic Car Controller Pro/Textures/Upgrades/Logo_Engine.png": "https://static.seeles.ai/data/upload/54903e6a-5e71-436e-ac47-dab7d8ab3fba_Logo_Engine.png",
  "Realistic Car Controller Pro/Textures/Upgrades/Logo_Neon.png": "https://static.seeles.ai/data/upload/5cd4bc56-bf4a-47ed-93e3-2ae7b83fde3f_Logo_Neon.png",
  "Realistic Car Controller Pro/Textures/Upgrades/Logo_Paintball.png": "https://static.seeles.ai/data/upload/85eda8b9-3b25-405d-ac4a-1972e4a78fda_Logo_Paintball.png",
  "Realistic Car Controller Pro/Textures/Upgrades/Logo_Spoiler.png": "https://static.seeles.ai/data/upload/a205e693-fcbe-4f26-bab7-de707078fcd1_Logo_Spoiler.png",
  "Realistic Car Controller Pro/Textures/Decals/1.png": "https://static.seeles.ai/data/upload/cfdbefce-4916-43d8-9438-e823a588a677_1.png",
  "Realistic Car Controller Pro/Textures/Decals/2.png": "https://static.seeles.ai/data/upload/49d7afd8-2d0e-48d0-8821-d7ac30ffaa81_2.png",
  "Realistic Car Controller Pro/Textures/Decals/4.png": "https://static.seeles.ai/data/upload/e42fceda-fcce-46cd-81ed-da4fb6660192_4.png",
  "Realistic Car Controller Pro/Textures/Decals/5.png": "https://static.seeles.ai/data/upload/478fff80-beb2-409f-b8da-4d5b5afed804_5.png",
  "Realistic Car Controller Pro/Textures/Decals/6.png": "https://static.seeles.ai/data/upload/700d186b-ee66-407c-b1fe-4535e2aee1ed_6.png",
  "Realistic Car Controller Pro/Textures/Decals/7.png": "https://static.seeles.ai/data/upload/3030ad2b-63d0-4b28-9d49-e5d6c7dd1b36_7.png",
  "Realistic Car Controller Pro/Textures/Decals/8.png": "https://static.seeles.ai/data/upload/369f9de1-e0e7-487a-a10d-5a4f80b13954_8.png",
  "Realistic Car Controller Pro/Textures/Decals/9.png": "https://static.seeles.ai/data/upload/399c6924-323b-41c4-a444-c88dd5452d37_9.png",
  "Realistic Car Controller Pro/Textures/Wheels/1.png": "https://static.seeles.ai/data/upload/b3ee0d9d-0f13-4d12-aa2e-d433e28456fd_1.png",
  "Realistic Car Controller Pro/Textures/Wheels/2.png": "https://static.seeles.ai/data/upload/213181b6-6df1-4a7c-add2-e6b3298238f2_2.png",
  "Realistic Car Controller Pro/Textures/Wheels/3.png": "https://static.seeles.ai/data/upload/2733075d-cc1d-491b-b7e4-0b6669a1ae07_3.png",
  "Realistic Car Controller Pro/Textures/Wheels/4.png": "https://static.seeles.ai/data/upload/65b12832-39eb-4b0f-aea6-ce06628b4b89_4.png",
  "Realistic Car Controller Pro/Textures/Wheels/5.png": "https://static.seeles.ai/data/upload/51bd1e89-bac7-41bf-929b-2108e6bccfe6_5.png",
  "Realistic Car Controller Pro/Textures/Wheels/6.png": "https://static.seeles.ai/data/upload/89852168-a11f-4fde-9984-bb0b014e82ad_6.png",
  "Realistic Car Controller Pro/Textures/Wheels/7.png": "https://static.seeles.ai/data/upload/58d76518-c8aa-40de-8c44-87f278183631_7.png"
};

export function rootAssetUrl(relativePath) {
  if (/^(?:[a-z]+:)?\/\//i.test(relativePath)) return relativePath;
  const mapped = REMOTE_ASSET_URLS[relativePath];
  if (mapped) return mapped;
  return `${ROOT_URL}${relativePath.replace(/\\/g, "/")}`;
}

export function normalizeModel(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.geometry = child.geometry?.clone?.() || child.geometry;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material?.map) material.map.colorSpace = THREE.SRGBColorSpace;
      if (material) material.needsUpdate = true;
    });
    if (child.geometry?.attributes?.position) {
      const positions = child.geometry.attributes.position.array.slice();
      child.userData.basePositions = positions;
    }
  });
}

export const normalizeUiToken = (value) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function vectorFromData(value, fallback = new THREE.Vector3()) {
  if (!value) return fallback.clone();
  return new THREE.Vector3(
    value.x ?? fallback.x,
    value.y ?? fallback.y,
    value.z ?? fallback.z
  );
}

export function quaternionFromData(value, fallback = new THREE.Quaternion()) {
  if (!value) return fallback.clone();
  return new THREE.Quaternion(
    value.x ?? fallback.x,
    value.y ?? fallback.y,
    value.z ?? fallback.z,
    value.w ?? fallback.w
  );
}
