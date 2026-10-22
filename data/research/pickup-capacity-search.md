## [web:https://kwicktogo.com/blog/pickup-scheduling-system-restaurant.html] Smart Pickup Scheduling: Eliminate Customer Wait Times
Capacity-aware time slots — the system knows how many orders your kitchen can produce per 5-minute or 15-minute window and only offers slots

## [doc:https://github.com/microsoftdocs/dynamics-365-unified-operations-public/blob/7dee2e089ec38e2e3fbb1a0bda9269f3d8890347/articles/commerce/dev-itpro/pickup-timeslots.md] (doc) Create and update time slots for customer pickup
License: CC-BY-4.0
# Create and update time slots for customer pickup

[!INCLUDE banner]

This article describes how to create, configure, and update customer pickup time slots in Microsoft Dynamics 365 Commerce headquarters.

The time slot feature gives retailers a way to define a time slot for items when the customer pickup delivery mode is turned on. Time slots let retailers define the days and times when orders can be picked up from a store. Retailers can also define the number of orders that can be picked up during a given period. In this way, retailers can limit the number of orders that customers can pick up on a given day and at a given time. The result is a better-quality experience for their customers.

> [!NOTE]
> The time slot feature is available in Microsoft Dynamics 365 Commerce version 10.0.15 and later.

The following illustration shows an example of time slot selection during e-commerce checkout.

:::image type="content" source="../dev-itpro/media/Curbside_timeslot_eCommerce.PNG" alt-text="Screenshot of time slot selection during e-commerce checkout.":::

## Time slot properties

A time slot is a specific interval when a customer can choose to pick up an order from a specific store or location. The time slot management feature is available only when the customer pickup delivery mode is configured in Dynamics 365 Commerce.

Define a time slot by using the following properties:

- **Mode of delivery** – Specify the pickup mode of delivery that the time slot applies to.
- **Minimum Days** and **Maximum Days** – Specify the earliest and latest dates that customers can select for pickup relative to the date when the order is placed.

    The **Minimum Days** property ensures that there's enough time for the retailer to process the order before it's ready for pickup. The **Maximum Days** property ensures that the user can't select a date that is too far in the future. For example, if you set the minimum value to **1**, and an order is placed on September 20, the earliest day that the order is available for pickup is the next eligible day (September 21). In a similar way, by setting a maximum value, you can define the maximum number of days that an order can be picked up. When you define minimum and maximum values, site users can see and select only a specific set of days during their checkout experience.

    You can set the minimum value to a decimal value that's less than 1. For example, if pickup is available four hours after an order is placed, set the minimum value to **0.17** (= 4 ÷ 24, rounded up to two decimal places). However, if you set the minimum value to a decimal value that's more than 1, it's always rounded up to the nearest whole number. For example, a value of **1.2** is rounded up to **2**. Similarly, if you set the maximum value to a decimal value, it's always rounded up to the nearest whole number.

- **Start Date** and **End Date** – Specify the start and end dates of the time slot. Each time slot entry has a start date and an end date. Therefore, you have the flexibility to add different time slots throughout the year (for example, pickups during holiday hours). If you change a time slot's start and end dates after an order is placed, the changes don't apply to that order. When you define start and end dates, consider store closure dates (for example, Christmas day) and ensure that time slots aren't defined for those days.
- **Active Hours of Pickup** – Specify the period when pickup is allowed. For example, the pickup times might be between 2 PM and 5 PM every day. This property enables the pickup times to be independent of store hours. Therefore, the retailer can configure pickup times that meet its specific business requirements. When you define the active hours of pickup, consider store hours and ensure that pickup times aren't defined for times when the store is closed.

    > [!NOTE]
    > The hours for store pickup must be defined in the time zone of the appropriate store.

- **Time Slot Interval** – Specify the duration that you allot to each time slot. For example, the duration of each time slot might be in increments of 15 minutes, 30 minutes, or one hour. If the time slot value is 0, the time slot is available for the entire duration between the start and end time.
- **Slots Per Interval** – Specify the number of customers or orders that the store can serve for pickup during each time slot interval. For example, enter **1**, **2**, **3**, or any other whole number.
- **Active Days** – Specify the days of the week when the pickup time slots are active. This property lets the retailer define the days when it wants to support pickup orders.
- **Retail Channels** – Specify the retail channels. Associate each time slot with one or more retail stores. Depending on each store's hours of operation, create one or more time slot entries and associate them with a channel.

Configure only one time slot template per channel. These channels include brick-and-mortar stores, call centers, mobile devices, and e-Commerce sites.

## [web:https://storekit.com/docs/guides/orders/advanced/pre-orders] Pre-orders: schedule future pickup and delivery - docs
Pickup and delivery can have different slot lengths, capacity limits, scheduling rules, and available times. 6. Configure Slot Length. Choose

## [web:https://chwazidatetime.com/docs/delivery-pickup-scheduling/] Delivery & Pickup Scheduling - Chwazi
Decide whether you'd like to set capacity restrictions by Days of the week or Time slots. Days of the week option #. Enter the maximum number of

## [web:https://www.supersaas.com/info/doc/process/limitations] User Process | Set booking constraints
Capacity schedules let you set limits on how many bookings can be made per time slot (default capacity per slot). You can also control how many bookings a