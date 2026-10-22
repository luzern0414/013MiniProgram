## [doc:https://docs.medusajs.com/references/fulfillment/models/ServiceZone/index.html.md] (doc) index.html
## Service Zone
A service zone is a collection of geographical zones or areas. It’s used to restrict available shipping options to a defined set of locations.

A service zone is represented by the ServiceZone data model. It’s associated with a fulfillment set, as each service zone is specific to a form of fulfillment. For example, if a customer chooses to pick up items, you can restrict the available shipping options based on their location.

A diagram showcasing the relation between fulfillment sets, service zones, and geo zones

A service zone can have multiple geographical zones, each represented by the GeoZone data model. It holds location-related details to narrow down supported areas, such as country, city, or province code.

The province code is always in lower-case and in ISO 3166-2 format.

## [doc:https://github.com/medusajs/medusa/blob/61c19c3099d58b3b3900da70d92a647c33b09bb5/www/apps/resources/app/commerce-modules/fulfillment/shipping-option/page.mdx] (doc) {metadata.title}
License: NOASSERTION
# {metadata.title}
In this document, you’ll learn about shipping options and their rules.

## Shipping Option Price Type
- `calculated`: The shipping option has no stored price. Instead, its price is calculated during checkout by the shipping option's fulfillment provider. This is useful when the price depends on the cart's contents, the customer's location, or a rate returned by a third-party service.

### How Calculated Prices are Resolved
For a shipping option of type `calculated`, Medusa invokes the calculatePrice method of the associated fulfillment provider to resolve the price against the cart.

#### Passing Custom Context to calculatePrice

## Service Zone Restrictions
A shipping option is restricted by a service zone, which limits the locations where the shipping option can be used.

For example, a fulfillment provider may have a shipping option that can be used in the United States and another in Canada.

Service zones can be more restrictive, such as limiting to certain cities or province codes.

The province code is always in lowercase and in ISO 3166-2 format.

A diagram showcasing the relation between shipping options, service zones, and geo zones

## Shipping Option Rules
For example, you can make a shipping option's price free based on the cart total.

## [doc:https://github.com/medusajs/medusa/blob/61c19c3099d58b3b3900da70d92a647c33b09bb5/www/apps/user-guide/app/settings/locations-and-shipping/locations/page.mdx] (doc) {metadata.title}
License: NOASSERTION
# {metadata.title}
## Create Shipping Options
Shipping options are organized by service zones in each shipping mode. A service zone is a geographical area where you can specify the shipping options available. For example, you can create a service zone for the United States, and specify the shipping options available in the US.

So, to create a shipping option for either pick-up or shipping, you need to enable the pick-up or shipping mode, create a service zone for that mode, and create the shipping option within that zone.

### 2. Create Service Zone
To ceate a service zone for pick-up or shipping:

### 3. Create Shipping Options
2. In the "Pickup" or "Shipping" section, find the service zone you want to add the shipping option to.
4. In the form that opens:
   - If the shipping option isn't a pick-up option, you can choose the price type. Choose **Fixed** if you want to apply fixed pricing for the shipping option, or **Calculated** if the price should be calculated dynamically during checkout. Calculated prices are useful if you're using a third-party fulfillment provider that calculates prices dynamically.
     - If you chose Fixed, you'll set the price in the next step of the form.
     - If you choose Calculated and the fulfillment provider you choose doesn't support calculated prices, the shipping option creation will fail.
   - In the Fulfillment Provider field, choose the fulfillment provider that will handle shipping orders using this option.
     - If you don't find the fulfillment provider you're looking for, make sure it's added to the location.
   - In the Fulfillment Option field, choose a fulfillment option from the fulfillment provider. For example, UPS may provide express or standard fulfillment options.
     - If you're unsure about which fulfillment option to choose, contact your technical team for assistance based on the integrated fulfillment service.

## [issue:medusajs/medusa#13277] (issue) [Bug]: Custom shipping option rules not working#13277
https://github.com/medusajs/medusa/issues/13277
License: NOASSERTION
# [Bug]: Custom shipping option rules not working#13277
## Description
### Package.json file

### What happended?

### Link to reproduction repo
@dracz-fl, to filter shipping options based on the cart address, you actually need to use Geo Zones.

When you create a service zone, you can specify what geographical areas it serves. These areas are Geo Zones.

Now, if you create shipping options within this service zone, they will only show for your customer if they have entered an address within the city of Sommerville.

## [web:https://www.eryxinnovationslab.com/blog/medusa-fulfillment-providers] Medusa Fulfilment: Service Zones and Custom Providers
. +Shipping options are flat-rate or calculated. Calculated options ask your fulfilment provider for a price at checkout, based on the cart's