import { stripe } from "../shared/providers";
import { revenueWidgets } from "../shared/widgets";

export default revenueWidgets(stripe).number;
