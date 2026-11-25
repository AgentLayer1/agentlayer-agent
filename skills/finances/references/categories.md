# Categories

The finances skill's default categories, and how to tell them apart. The agent reads this before it suggests a category; the operator's `RULES.md` adds to it and wins wherever the two disagree. The engine never reads the prose here; only the list below feeds the dashboard's category picker when `RULES.md` doesn't name its own.

## Categories

```yaml
- groceries
- food
- transport
- car
- travel
- housing
- utilities
- subscriptions
- shopping
- home
- health
- insurance
- education
- kids
- family
- gifts
- personal care
- entertainment
- charity
- zakat
- fees
- tax
- software
- professional
- payroll
- office
- income
- transfer
- director
```

## How to tell them apart

- **groceries**: supermarkets, hypermarkets, wet markets, grocery delivery. **food**: restaurants, cafés, food courts, food delivery (GrabFood, Foodpanda, ShopeeFood).
- **transport**: ride-hailing rides (Grab rides, Bolt), fuel, tolls, parking, public transport. **car**: servicing, repairs, road tax, car takaful, car loans' instalments. A ride-hailing company's food orders are **food**, its rides **transport**; when the description can't tell them apart, leave it for the operator or use a matched receipt.
- **travel**: airlines, flight and hotel bookings (Booking.com, Agoda, Airbnb, Expedia), travel takaful, visas.
- **housing**: rent, property maintenance fees, quit rent and assessment. **utilities**: electricity, water, gas, internet, mobile and landline bills. **home**: furniture, appliances, household goods and repairs.
- **subscriptions**: streaming, apps and memberships billed on a schedule. **software**: tools a business uses (hosting, SaaS, developer tools); the same product bought personally is a subscription.
- **health**: clinics, hospitals, dental, pharmacy, therapy. **insurance**: takaful and insurance premiums other than car and travel.
- **education**: school and university fees, courses, books. **kids**: children's activities, classes, childcare, school supplies. **family**: money sent to support relatives.
- **charity**: sadaqah, donations, masjid and orphan sponsorships. **zakat**: zakat payments only, kept apart so the year's zakat is one number.
- **fees**: bank, card, transfer and late fees. **tax**: payments to the tax authority. **professional**: accountants, lawyers, consultants, company secretaries. **payroll**: what a company pays its people, employer-of-record invoices included. **office**: a business's rent, supplies and equipment.
- **income**: salary, invoices paid, profit or hibah credited, refunds kept as income. **transfer**: money between the operator's own accounts in the same entity. **director**: money between a company and the operator, counted on the Director page.
- **A payment to a person** (a name, "Fund Transfer", a DuitNow to an account) is never guessed: it could be family, rent, a loan or a purchase. Leave it uncategorised for the operator.
