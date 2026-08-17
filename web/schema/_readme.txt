Dragos Scene Builder Schema Format
==================================

Every schema file can contain special sections used by Dragos Scene Builder.

Special sections:

- _meta
- _static
- _conditions

Anything not listed here is considered normal schema data.

---

The "_meta" section controls how the editor displays and processes the schema.
It does not become part of the generated output.

--------------------------------------------------
display_name
--------------------------------------------------

Changes the name shown in the UI.

Example:
"_meta": {
	"display_name": "Artist Styles"
}

If omitted, the filename is used instead.

Example:

artist.json

will be displayed as:

artist

Note:

When creating character schemas it is important to use:

{
	"_meta": {
		"display_name": "Character",
		"override": "no"
	},
	"_static": {
		"gender": "Female"
	}
}

Using "override": "no" allows multiple characters to exist in the same scene.

--------------------------------------------------
extension
--------------------------------------------------

Defines what the schema is an extension of.

Example:
"_meta": {
	"extension": "style"
},
"artist_styles" ["Rembrandt", "Caravaggio"]

Extensions are attached to matching schemas during processing.
using the example above would become
{
	"style": {
		"...",
		"artist_styles" ["Rembrandt", "Caravaggio"]
	}
}
instead of
{
	"style": {
		"..."
	},
	"artist_styles" ["Rembrandt", "Caravaggio"]
}

--------------------------------------------------
override
--------------------------------------------------

Controls how the schema behaves when another instance of the same type already exists.

Default:

"override": "yes"

If omitted, "yes" is assumed.

Example:

"override": "yes"

Merge into an existing target.

Example:

"override": "no"

Create a separate instance instead of merging.

This is commonly used for characters, accessories and other schema types that may appear multiple times in a scene.

--------------------------------------------------
multi_selects
--------------------------------------------------

Defines one or more multi-selection configurations.

Example:

"multi_selects": [  
	{  
		"applies_to": ["artist_styles"]  
	}  
]

this let's the user select multiple things from a list

--------------------------------------------------
multi_selects.applies_to
--------------------------------------------------

Defines which categories are affected by the multi-select configuration.

Example:

"applies_to": [  
"artist_styles"  
]

--------------------------------------------------
multi_selects.dividers
--------------------------------------------------

Creates visual divider headers inside a category.

Example:

"dividers": [  
	"Realistic Classical",  
	"Fantasy Sci-Fi Illustration",  
	"Anime & Manga"  
]

Divider values should also exist in the category list.

--------------------------------------------------
multi_selects.tags
--------------------------------------------------
Controls how selected values are formatted.

Example:

"tags": {  
	"prefix": "artist",  
	"allow_weight": true  
}

--------------------------------------------------
multi_selects.tags.prefix
--------------------------------------------------

Adds a prefix before each selected value.

Example:

Configuration:

"prefix": "artist"

Selected:

Rembrandt

Output:

artist:Rembrandt

--------------------------------------------------
multi_selects.tags.separator
--------------------------------------------------

Defines the separator used between tag components.

Optional.

Default:

":"

Example:

"separator": "|"

Output:

artist|Rembrandt

--------------------------------------------------
multi_selects.tags.allow_weight
--------------------------------------------------

Allows a weight value to be assigned to each selected item.

Optional.

Default:

false

Example:

artist:Rembrandt:1.3

If disabled or omitted:

artist:Rembrandt

--------------------------------------------------

The "_static" section contains values that are automatically included in the generated output.

Values in "_static" are not editable by the user.

Example:

"_static": {  
"gender": "Female",  
"character_type": "Anthropomorphic"  
}

Generated output will always contain:

{  
"gender": "Female",  
"character_type": "Anthropomorphic"  
}

--------------------------------------------------

The "_conditions" section controls when fields are shown or hidden.

Conditions are evaluated dynamically in the editor.

Fields can be displayed only when other fields contain specific values.

Example:

"_conditions": {  
	"tail_type": {  
		"species": ["Wolf", "Fox"]  
	}  
}

In this example:

tail_type

will only be visible when:

species

is set to:

Wolf

or

Fox

Conditions only affect editor visibility.

They do not modify generated output data.

- All _meta properties are optional.
- Unknown _meta properties are ignored.
- _meta controls editor behaviour.
- _static provides generated data.
- _conditions controls field visibility.
- Missing optional properties use default behaviour.