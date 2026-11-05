-- Independent private sold amounts. Preserve every existing booking amount,
-- buyer, broker, note and commercial/public status unchanged.
ALTER TABLE geo_client_plot_details_3d
 ADD COLUMN sold_amount_paise INTEGER
 CHECK(sold_amount_paise IS NULL OR sold_amount_paise BETWEEN 0 AND 1000000000000);
