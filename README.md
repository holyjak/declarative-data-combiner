
TODO
====

2. Add full annotated example; manufacture sample data to use
   - perhaps use https://dev.mysql.com/doc/employee/en/sakila-structure.html
3. Add "Switch", "FirstOf", see TODOs
4. Review the README, is it presented clearly and attractively, is the value clear?
5. Make configurable: loggerWarn, the used subset of lodash, ... ?

Declarative Data Combiner
=========================

Add new properties to a tree data structure from a number of other data structures in a declarative manner.

[!test status](https://codeship.com/projects/3fad06a0-7cbc-0134-501d-369b6cd4ca27/status?branch=master)

The "business case" for the declarative data combiner
------------------------------------------------------

The combiner was created for a "frontend backend," a server-side application that fetches product, price, services, content, etc.
JSON data from various sources and transforms them and combines them together to provide a single view of the data, optimized
 for the needs of the client-side frontend application.

Why?
----

It is easy - especially with functional programming - to massage and combine data into the form you want to have it. However, it is very difficult to know what data goes into and out of the transformation. The declarative data combiner makes at least part of it - the outgoing data, and where they come from - explicit, abstracting away the transformation process itself and focusing rather on the data and desired effect.

The idea is that you declare the shape of the input and output data and how the extra data are joined and added onto it.

Ideally, we would like to declare how the data we have should be joined and extended with the additional data:

```js
// (Given a productCatalog, a map of products with color variants, add extra data to them:
const productCatalogCombined = {
   <JOIN: productWebshopOverrides = webshopOverrides[productId]>
   <productId>: {
      specifications: "productWebshopOverrides.specifications",
      colorVariants: {
         <JOIN:  variantWebshopOverrides = productWebshopOverrides[variantId]>
         <variantId>: {
            images: "variantWebshopOverrides.images",
            description: "variantWebshopOverrides.description"
         }
      }
   }
};
```

JavaScript doesn't allow us to do exactly this, so we need to be somewhat more verbose:


```js
const productCatalogDef = Dictionary({ // process each value in a key -> value map (actually, a JS object)
   // A joins is similar to a SQL join. It takes a named "binding" and (maybe) produces a new one.
   joins: [Join({ key: "webshopOverrides", as: "productWebshopOverrides",
             fn: (webshopOverrides, product, productId) => webshopOverrides[productId]})],
   key: "productId", // for information purposes only,
   value: Template({
      // A "template" for extensions to the current object (a product, in this case);
      // all existing properties are also included in the result.
      // Values of the properties are replaced with values from the bindings
      specifications: "productWebshopOverrides.specifications" // the value will be replaced ...
      colorVariants: Dictionary({
         joins: [Join({ key: "productWebshopOverrides", as: "variantWebshopOverrides",
                   fn: (productWebshopOverrides, variant, variantId) => productWebshopOverrides.colorVariants[variantId]})],
         key: "variantId",
         value: Template({
            description: "variantWebshopOverrides.description";
         })
      })
   })
});
productCatalogCombined = combiner.combineAndResult(productCatalogDef, productCatalog, { webshopOverrides });
```


Introduction
------------

### Example

Assuming that you have this data:

```js
const productCatalog = {
   "ax-123-c": {
      brand: "Apple",
      model: "iPhone 7 256 GB",
      specifications: [],
      colorVariants: {
         "12345": {
            color: "Metal Black",
            htmlColor: "black",
            images: [],
            price: 9599,
            description: "..."
         }
      }
   }
};
```

and some other data that you want to combine with it:

```js
const webshopOverrides = {
   "ax-123-c": {
      specifications: [/* more reader-friendly specification descriptions for web shop ...*/],
      colorVariants: {
         "12345": {
            description: "A much better description for <blink>web</blink>",
            images: ["superAwesomeBlackIphone.png"]
         }
      }
   }
};
const pricePlans = {
   "12345": {
      "I_LOVE_DATA": {
         data: "20 GB",
         voice: "unlimited"
         // ...
      }
   }
};
```

and you would like to end up with

```js
const productCatalog = {
   "ax-123-c": {
      brand: "Apple",
      model: "iPhone 7 256 GB",
      specifications: [/* more reader-friendly specification descriptions for web shop ...*/],
      colorVariants: {
         "12345": {
            color: "Metal Black",
            htmlColor: "black",
            images: ["superAwesomeBlackIphone.png"]
            price: 9599,
            description: "A much better description for <blink>web</blink>",
         }
      },
      pricePlans: {
         "I_LOVE_DATA": {
            data: "20 GB",
            voice: "unlimited"
            // ...
          }
      }
   }
};
```

You could manually do that:

```js
_.mapValues(productCatalog, (product, productId) => { // Yes, we're lying, it isn't map but forEach
   const productWebshopOverrides = webshopOverrides[productId];
   product.specifications = productWebshopOverrides.specifications;
   product.pricePlans = pricePlans[_.first(_.values(product.colorVariants))];
   _.mapValues(product.colorVariants, (variant, variantId) => {
      variant.description = productWebshopOverrides.colorVariants[variantId].description;
   });
   return product;
});
```

but as the data becomes deeper and bigger and there are more and more complex other data sources,
it quickly becomes difficult to follow. With the declarative data combiner, you can instead do the
following, which is much easier to follow, once you learn the Domain Specific Language (DSL):


```js
const productCatalogDef = Dictionary({ // process each value in a key -> value map (actually, a JS object)
   joins: [
       Join({ // Similar to a SQL join; it takes a named "binding" and (maybe) produces a new one
          key: "webshopOverrides",
          as: "productWebshopOverrides",
          fn: (webshopOverrides, product, productId) => webshopOverrides[productId]
       }),
       Join({
         key: "pricePlans",
         as: "randomVariantPricePlan",
         fn: (pricePlans, product, productId) => pricePlans[_.first(_.values(product.colorVariants))]
      })
   ],
   key: "productId", // for information purposes only,
   value: Template({
      // A "template" for extensions to the current object (a product, in this case);
      // all existing properties are also included in the result.
      // Values of the properties are replaced with values from the bindings
      specifications: "productWebshopOverrides.specifications" // the value will be replaced ...
      pricePlans: "randomVariantPricePlan",
      colorVariants: Dictionary({
         joins: [Join({
                   key: "productWebshopOverrides",
                   as: "variantWebshopOverrides",
                   fn: (productWebshopOverrides, variant, variantId) => productWebshopOverrides.colorVariants[variantId]
         })],
         key: "variantId",
         value: Template({
            description: "variantWebshopOverrides.description";
         })
      })
   })
});
productCatalog = combiner.combineAndResult(productCatalogDef, productCatalog, { webshopOverrides, pricePlans });
```

This is considerably longer than the manual transformation above. And I wouldn't use it for such a simple transformation.
But as the data increases in complexity, the declarative approach starts to win in comprehensibility and in size
(at least in our case it did). Imagine being inside 5th nested function call transforming a part of the data and trying to
remember what the data looks like and where are you. Here you just look up the tree.

### Pros & Cons

Cons:

 - performance
 - initial learning curve

 Pros:

 - clearly communicates the output data and where it comes from
 - separates "what" data we want and "how" it is processed; we can improve the "how" independently - provide an audit
   trail of the processing, add optimizations, ...

### History

The declarative data combiner has been used in Telia Norge since 2014.

### Other concerns

#### Flexibility

TODO (declarative x functions)

#### Performance

TODO

User documentation and API reference
------------------------------------

See

1. [API Guide](./docs/API_GUIDE.md)
2. *TODO* A complete, annotated example of a combination definition
3. JSDoc of the DSL classes and `combine`
4. The unit tests

### API Introduction

- Dictionary, List, Template
- Joins, bindings
- extra: filter, ...
- flexibility: where can we use functions
- troubleshooting: audit, debug, functions calling console.log
