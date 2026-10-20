# Properties of a polygonal object

## 3D对象属性

A primitive is a three-dimensional geometric object formed by polygons and is used as a
predefined object in different development software. 

在建模相关软件中的三维对象，称为`primitives`，包括胶囊体，盒型、球形等等。

all have vertices, tangents,
normals, UV coordinates and color, which are stored within a data type called “mesh”.

对于polygonal object, 最常见的三个属性、Vertices（点），Polygons（面），Edges（线）

## Rendering Pipeline

渲染管线是3D引擎专为画面渲染定义的流水线，想要在屏幕上渲染任何画面或者对象，都必须经过一遍这个管线。

不同的渲染管线存在一些细微的差别，但大致相同。

在Unity中，渲染管线分为四个阶段：application、geometry processing、rasterization、pixel processing.

![](assets/Properties%20of%20a%20polygonal%20object/file-20261014121259494.png)

### application

在application中，主要由cpu处理和采集一系列相关的输入和数据，以便调度gpu进行下一阶段的计算。

### geometry processing

在geometry processing中，cpu将图像相关的属性计算使用的矩阵运算交给gpu进行。

### rasterization

光栅化阶段做的是根据三角形数据，绘制**fragments**，也就是片段。

### Pixel processing

又称为fragments shader stage，在这一步根据片段的信息，对片段中的像素进行“上色”。

### Rendering Path

Forward is the default rendering path and supports all typical features of a material (e.g.
normal maps, pixel lighting, shadows, etc.). This rendering path has two different code
written passes that we can use in our shader, the first, base pass and the second additional
pass.
In the base pass, we can define the ForwardBase light mode and in the additional pass, we
can define the ForwardAdd light mode. Both are characteristic functions of a shader with
lighting calculation. The base pass can process directional light per-pixel and will use the
brightest light if there are multiple directional lights in the scene. In addition, the base pass
can process light probes, global illumination, and ambient illumination (skylight).
As its name says, the additional pass can process “additional lights” per-pixel or also
shadows that affect the object, what does this mean? If we have two lights in the scene,
our object will be influenced only by one of them, however, if we have defined an additional
pass for this configuration, then it will be influenced by both.

One point that we must take into consideration is that each illuminated pass will generate a
separate draw call. A draw call is a call graphic that is made in the GPU every time we want
to draw an element on the screen of our computer. These calls are processes that require
a large amount of computation, so they need to be kept to a minimum possible, even more
so if we are working on projects for mobile devices.

**Draw Call**是CPU向GPU发送绘制指令的过程，需要消耗极大的CPU计算量，因此在实际开发中，最应该考虑的绘制策略是减少**Draw Call**的次数。
# Unity Shader


