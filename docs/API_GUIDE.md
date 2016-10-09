API Guide
=========

How does it work?
-----------------

The combiner traverses a "source" tree data structure (in a depth-first manner), joins it at appropriate places with other
data structures, and finally injects new properties based on these other data into the source data structure, optionally
doing some minor transformation on the structure or data. You need to create a "combination definition" that both describes
(or rather matches) the source data structure and defines where and how to join it with the other data and where to inject
 new properties.

It has two key assumptions:

You already have a tree-shaped data ("source data") that is in more less the shape you need it and you
just need to enrich it with additional properties from other data structures.

The source data is a (nested) combination of collection elements (arrays, "dictionaries"), which need to be traversed,
and value elements (plain old JS objects) into which new properties should be added.

Domain Specific Language (DSL) for defining combinations
--------------------------------------------------------

**TODO** example pic data + def.

### Terminology: Bindings

Bindings contained additional, named data available at a particular place during the processing. You can pass in
initial bindings when invoking the combiner and you can add to them via Joins (see below). The data in bindings is
typically used to produce the new properties, with values from the additional data sources.

### Dictionary, List

Dictionary and List match collections of values with the same structure and possibly some kind of a key. A typical
example would be Object<employee id, employee> or Array<employee>. The combiner iterates over them and processes each
value.

They can also describe how to join the current source element (i.e. value) being processed with the additional data
(to use the matched part of the additional data to inject new properties into it).


### Template

A Template matches a value object and defines what properties should be added to it based on the bindings available
at that moment. The existing properties of the matched object are copied as they are, you do not need to explicitely mention them.
(Though you can also completely replace the original object with what is defined in the Template if you want to.)

### Join(s)

A join defines how to join the source element currently being processed with data in bindings, producing a new named
binding. For example, while processing employees, we might want to join the current employee with `emploeeSalaries`
based on the employee's ID, producing `employeeSalary` (that we perhaps want to add to the employee object).