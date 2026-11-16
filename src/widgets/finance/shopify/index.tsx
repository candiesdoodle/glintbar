import { shopify } from "../shared/providers";
import { revenueWidgets } from "../shared/widgets";

export default revenueWidgets(shopify).number;
